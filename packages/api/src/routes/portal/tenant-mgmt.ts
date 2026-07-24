// ──────────────────────────────────────────────────────
// Portal: /portal/tenants, /portal/settings, /portal/transfer-ownership
// Tenant management endpoints
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { supabase } from '../../db/supabase.js'
import {
  updateSettingsSchema,
  transferOwnershipSchema,
  portalTenantCreateSchema,
} from '../schemas.js'
import { requirePortalSession, requirePortalRole, getSession } from '../../middleware/session-auth.js'
import type { PortalSession } from '../../middleware/session-auth.js'
import { supabaseError } from '../../lib/response.js'
import { logAuditEvent } from '../../lib/audit.js'
import { generateApiKey } from '../../lib/api-key.js'
import { invalidatePlanCache } from '../../lib/plan-store.js'
import { dispatchWebhook } from '../../lib/webhook-dispatcher.js'
import { logger } from '../../lib/logger.js'
import { checkIpCreationLimit } from '../../middleware/rate-limit.js'

export const tenantMgmtRoutes = new Hono()

// ── PATCH /portal/settings — Update tenant settings ──
tenantMgmtRoutes.patch('/portal/settings', requirePortalSession, requirePortalRole('owner', 'admin'), zValidator('json', updateSettingsSchema), async (c) => {
  const session: PortalSession = getSession(c)
  const body = c.req.valid('json')

  const updates: Record<string, unknown> = {}
  if (body.name) updates.name = body.name
  if (body.settings) updates.settings = body.settings
  if (body.config) updates.config = body.config

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No fields to update' }, 400)
  }

  const { data: tenant, error } = await supabase
    .from('tenants')
    .update(updates)
    .eq('id', session.tenant_id)
    .select()
    .single()

  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'tenant.settings_updated',
    resource: `tenant:${session.tenant_id}`,
    details: { updated_fields: Object.keys(updates), updated_by: session.email },
  })

  return c.json(tenant)
})

// ── POST /portal/transfer-ownership — Transfer tenant ownership ──
tenantMgmtRoutes.post('/portal/transfer-ownership', requirePortalSession, requirePortalRole('owner'), zValidator('json', transferOwnershipSchema), async (c) => {
  const session: PortalSession = getSession(c)
  const body = c.req.valid('json')

  const { data: newOwner } = await supabase
    .from('tenant_users')
    .select('id, role')
    .eq('tenant_id', session.tenant_id)
    .eq('user_id', body.new_owner_user_id)
    .single()

  if (!newOwner) return c.json({ error: 'Target user is not a member of this tenant' }, 404)

  const { error: err1 } = await supabase
    .from('tenant_users')
    .update({ role: 'admin' })
    .eq('id', session.membership_id)

  if (err1) return supabaseError(c, err1)

  const { error: err2 } = await supabase
    .from('tenant_users')
    .update({ role: 'owner' })
    .eq('id', newOwner.id)

  if (err2) {
    await supabase.from('tenant_users').update({ role: 'owner' }).eq('id', session.membership_id)
    return supabaseError(c, err2)
  }

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'tenant.ownership_transferred',
    resource: `tenant:${session.tenant_id}`,
    details: { from_user: session.user_id, to_user: body.new_owner_user_id },
  })

  return c.json({ success: true })
})

// ── GET /portal/tenants — List all tenants the current user belongs to ──
tenantMgmtRoutes.get('/portal/tenants', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)

  const { data: memberships, error } = await supabase
    .from('tenant_users')
    .select('id, role, joined_at, tenant:tenants(id, name, slug, plan_id, is_active, created_at)')
    .eq('user_id', session.user_id)
    .order('joined_at', { ascending: false })

  if (error) return supabaseError(c, error)

  const tenants = (memberships ?? []).map((m: Record<string, unknown>) => {
    const tenant = (m.tenant as Record<string, unknown>) ?? {}
    return {
      membership_id: m.id,
      role: m.role,
      joined_at: m.joined_at,
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan_id,
      is_active: tenant.is_active,
      created_at: tenant.created_at,
    }
  })

  return c.json({ tenants })
})

// ── POST /portal/tenants — Create a new tenant (authenticated, enforces max_tenants) ──
tenantMgmtRoutes.post('/portal/tenants', requirePortalSession, zValidator('json', portalTenantCreateSchema), async (c) => {
  const session: PortalSession = getSession(c)
  const body = c.req.valid('json')

  // 1. Check slug uniqueness
  const { data: existing } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', body.slug)
    .maybeSingle()

  if (existing) {
    return c.json({ error: 'A tenant with this slug already exists' }, 409)
  }

  // 2. Verify the Free plan exists
  const { data: freePlan } = await supabase
    .from('plans')
    .select('id, max_tenants, max_users')
    .eq('id', 'free')
    .single()

  if (!freePlan) {
    return c.json({ error: 'System configuration error: Free plan not found. Contact support.' }, 500)
  }

  // 3. Enforce max_tenants: count user's existing tenants
  const { count: currentTenantCount } = await supabase
    .from('tenant_users')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', session.user_id)

  const maxTenants = freePlan.max_tenants ?? 3
  if (currentTenantCount && currentTenantCount >= maxTenants) {
    return c.json({
      error: `Plan limit reached: You can have up to ${maxTenants} tenants on the Free plan. Upgrade to create more.`,
      code: 'PLAN_LIMIT_REACHED',
      limit: maxTenants,
      current: currentTenantCount,
    }, 403)
  }

  // 4. Create the tenant
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({
      name: body.name,
      slug: body.slug,
      plan_id: 'free',
      features: {},
      config: {},
      settings: { name: body.name },
      is_active: true,
    })
    .select()
    .single()

  if (tenantError) return supabaseError(c, tenantError)
  if (!tenant) return c.json({ error: 'Failed to create tenant' }, 500)

  // 5. Create owner membership
  const { error: membershipError } = await supabase
    .from('tenant_users')
    .insert({ tenant_id: tenant.id, user_id: session.user_id, role: 'owner' })

  if (membershipError) {
    try {
      await supabase.from('tenants').delete().eq('id', tenant.id)
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr, tenantId: tenant.id }, 'Portal tenant create: rollback delete failed')
    }
    return supabaseError(c, membershipError)
  }

  // 6. Create a default API key
  const { rawKey, keyHash, keyPrefix } = generateApiKey()

  try {
    await supabase.from('api_keys').insert({
      tenant_id: tenant.id,
      label: 'Default',
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: ['read', 'write'],
      created_by: session.user_id,
    })
  } catch {
    logger.warn({ tenantId: tenant.id, userId: session.user_id }, 'Portal tenant: failed to create default API key')
  }

  // 7. Log audit event + dispatch webhook
  await logAuditEvent({
    tenant_id: tenant.id,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'tenant.created',
    resource: `tenant:${tenant.id}`,
    details: { name: body.name, slug: body.slug, created_by: session.email },
  })
  dispatchWebhook('tenant.created', tenant.id, { name: body.name, slug: body.slug, email: session.email })

  // 8. Invalidate plan cache
  invalidatePlanCache(tenant.id)

  return c.json({
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan_id,
    api_key: rawKey,
  }, 201)
})
