// ──────────────────────────────────────────────────────
// Tenant routes — create, read, update tenants
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { createHash } from 'node:crypto'
import { supabase } from '../db/supabase'
import { createTenantSchema, updateTenantSchema, createApiKeySchema } from './schemas'
import { requireApiKey, requireScope } from '../middleware/auth'
import { generateApiKey } from '../lib/api-key'
import { supabaseError } from '../lib/response'
import { logAuditEvent, getClientIp } from '../lib/audit'
import { getPaginationParams, paginationResponse } from '../lib/pagination'
import { logger } from '../lib/logger'
import { checkIpCreationLimit } from '../middleware/rate-limit'

export const tenantRoutes = new Hono()

// ── Create a new tenant (public — no API key needed) ──
// BILLING ENFORCEMENT: Public creation always gets the Free plan.
// Users must upgrade via the portal to access paid plans.
// Using zValidator first to validate input shape, then validatePlanId
// to ensure the (forced) free plan actually exists in the DB.
tenantRoutes.post('/tenants', zValidator('json', createTenantSchema), async (c) => {
  const body = c.req.valid('json')
  const clientIp = getClientIp(c)
  const userAgent = c.req.header('user-agent') ?? null

  // IP-based rate limiting: max 5 tenants per hour per IP
  if (checkIpCreationLimit(clientIp)) {
    logger.warn({ ip: clientIp }, 'Anonymous tenant creation rate limit exceeded')
    return c.json({ error: 'Too many tenants created from this IP. Try again later.' }, 429)
  }

  // Check slug uniqueness
  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', body.slug)
    .maybeSingle()

  if (existing) {
    return c.json({ error: 'A tenant with this slug already exists' }, 409)
  }

  // Verify the Free plan exists in the DB
  const { data: freePlan } = await supabase
    .from('plans')
    .select('id, name, max_tenants, max_users, api_calls_per_day')
    .eq('id', 'free')
    .single()

  if (!freePlan) {
    return c.json({ error: 'System configuration error: Free plan not found. Contact support.' }, 500)
  }

  // Create tenant — ALWAYS Free plan for public endpoint
  const { data: tenant, error } = await supabase
    .from('tenants')
    .insert({
      name: body.name,
      slug: body.slug,
      plan_id: 'free',
      features: {},
      config: {},
      settings: {},
    })
    .select()
    .single()

  if (error) return supabaseError(c, error)

  // Generate initial API key
  const { rawKey, keyHash, keyPrefix } = generateApiKey()

  await supabase.from('api_keys').insert({
    tenant_id: tenant.id,
    label: 'Default',
    key_hash: keyHash,
    key_prefix: keyPrefix,
    scopes: ['read', 'write'],
  })

  // Log audit event
  await logAuditEvent({
    tenant_id: tenant.id,
    actor_type: 'system',
    action: 'tenant.created',
    resource: `tenant:${tenant.id}`,
    details: { name: body.name, slug: body.slug, plan: 'free' },
    ip: clientIp,
    user_agent: userAgent,
  })

  return c.json({ ...tenant, api_key: rawKey }, 201)
})

// ── Get current tenant (from API key) ──
tenantRoutes.get('/tenants/me', requireApiKey, async (c) => {
  const apiKey = c.get('apiKey')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', apiKey.tenant_id)
    .single()

  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  // Resolve features: plan defaults + tenant overrides
  const { data: plan } = await supabase
    .from('plans')
    .select('features')
    .eq('id', tenant.plan_id)
    .single()

  const features = {
    ...((plan?.features ?? {}) as Record<string, unknown>),
    ...((tenant.features ?? {}) as Record<string, unknown>),
  }

  // Update last_used — intentionally non-blocking, fire-and-forget
  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', createHash('sha256').update(apiKey.raw).digest('hex'))
    .then(undefined, err => {
      logger.warn(err, 'Failed to update last_used_at')
    })

  return c.json({
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan_id,
    features,
    config: tenant.config,
    settings: tenant.settings,
  })
})

// ── List tenants (admin only, paginated) ──
tenantRoutes.get('/tenants', requireApiKey, requireScope('admin'), async (c) => {
  const { page, limit, offset } = getPaginationParams(c)

  const { data: tenants, error, count } = await supabase
    .from('tenants')
    .select('id, name, slug, plan_id, is_active, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return supabaseError(c, error)
  return c.json({ tenants, pagination: paginationResponse(page, limit, count ?? 0) })
})

// ── Get single tenant by ID (admin only — cross-tenant read) ──
tenantRoutes.get('/tenants/:id', requireApiKey, requireScope('admin'), async (c) => {
  const id = c.req.param('id')

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !tenant) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  return c.json(tenant)
})

// ── Update tenant (admin only) ──
tenantRoutes.patch('/tenants/:id', requireApiKey, requireScope('admin'), zValidator('json', updateTenantSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const { data: tenant, error } = await supabase
    .from('tenants')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return supabaseError(c, error)
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404)

  return c.json(tenant)
})

// ── Create API key for tenant (self-service — verifies ownership) ──
tenantRoutes.post('/tenants/:id/api-keys', requireApiKey, zValidator('json', createApiKeySchema), async (c) => {
  const tenantId = c.req.param('id')
  const authApiKey = c.get('apiKey')
  const body = c.req.valid('json')

  // Ensure the API key's tenant matches the requested tenant ID
  if (authApiKey.tenant_id !== tenantId) {
    return c.json({ error: 'Tenant ID mismatch' }, 403)
  }

  const { rawKey, keyHash, keyPrefix } = generateApiKey()

  const { data: apiKey, error } = await supabase
    .from('api_keys')
    .insert({
      tenant_id: tenantId,
      label: body.label,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: body.scopes,
    })
    .select()
    .single()

  if (error) return supabaseError(c, error)

  return c.json({ ...apiKey, raw_key: rawKey }, 201)
})
