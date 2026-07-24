// ──────────────────────────────────────────────────────
// Portal: /portal/register — Public sign-up + create tenant
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { zValidator } from '@hono/zod-validator'
import { supabase } from '../../db/supabase.js'
import { registerSchema } from '../schemas.js'
import { getAdapter } from '../../auth/index.js'
import { supabaseError } from '../../lib/response.js'
import { logAuditEvent, getClientIp } from '../../lib/audit.js'
import { dispatchWebhook } from '../../lib/webhook-dispatcher.js'
import { generateApiKey } from '../../lib/api-key.js'
import { logger } from '../../lib/logger.js'
import { checkIpCreationLimit } from '../../middleware/rate-limit.js'

export const registerRoutes = new Hono()

// ── POST /portal/register — Sign up a new user + create their tenant ──
registerRoutes.post('/portal/register', zValidator('json', registerSchema), async (c) => {
  const body = c.req.valid('json')
  const clientIp = getClientIp(c)
  const userAgent = c.req.header('user-agent') ?? null

  // IP-based rate limiting: max 5 registrations per hour per IP
  if (checkIpCreationLimit(clientIp)) {
    logger.warn({ ip: clientIp }, 'Portal registration rate limit exceeded')
    return c.json({ error: 'Too many registrations from this IP. Try again later.' }, 429)
  }

  // 1. Check slug uniqueness
  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', body.tenant_slug)
    .maybeSingle()

  if (existingTenant) {
    return c.json({ error: 'Organization slug is already taken' }, 409)
  }

  // 2. Create the user via the auth adapter
  const auth = getAdapter()
  let userId: string
  try {
    const user = await auth.createUser(body.email, body.password)
    userId = user.id
  } catch (signUpErr) {
    const msg = signUpErr instanceof Error ? signUpErr.message : 'Failed to create user'
    return c.json({ error: msg }, 400)
  }

  try {
    // 3. Create the tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        name: body.tenant_name,
        slug: body.tenant_slug,
        plan_id: 'free',
        features: {},
        config: {},
        settings: { name: body.tenant_name },
        is_active: true,
      })
      .select()
      .single()

    if (tenantError || !tenant) {
      await supabase.auth.admin.deleteUser(userId).catch((deleteErr) => {
        logger.warn({ err: deleteErr, userId }, 'Registration cleanup: failed to delete user after tenant creation failure')
      })
      return supabaseError(c, tenantError)
    }

    // 4. Create owner membership
    const { error: membershipError } = await supabase
      .from('tenant_users')
      .insert({ tenant_id: tenant.id, user_id: userId, role: 'owner' })

    if (membershipError) {
      try { await supabase.from('tenants').delete().eq('id', tenant.id) } catch (cleanupErr) { logger.warn({ err: cleanupErr, tenantId: tenant.id }, 'Registration cleanup: failed to delete tenant') }
      try { await supabase.auth.admin.deleteUser(userId) } catch (cleanupErr) { logger.warn({ err: cleanupErr, userId }, 'Registration cleanup: failed to delete user') }
      return supabaseError(c, membershipError)
    }

    // 5. Create a default API key
    const { rawKey } = generateApiKey()

    await supabase.from('api_keys').insert({
      tenant_id: tenant.id,
      label: 'Default',
      key_hash: createHash('sha256').update(rawKey).digest('hex'),
      key_prefix: rawKey.slice(0, 8),
      scopes: ['read', 'write'],
      created_by: userId,
    })

    // 6. Log audit event + dispatch webhook
    await logAuditEvent({
      tenant_id: tenant.id,
      actor_id: userId,
      actor_type: 'user',
      action: 'tenant.created',
      resource: `tenant:${tenant.id}`,
      details: { email: body.email, name: body.tenant_name },
      ip: clientIp,
      user_agent: userAgent,
    })
    dispatchWebhook('tenant.created', tenant.id, { email: body.email, name: body.tenant_name })

    // 7. Sign the user in so they get a session
    const sessionResult = await auth.signIn(body.email, body.password)

    return c.json({
      success: true,
      user: { id: userId, email: body.email },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      api_key: rawKey,
      session: sessionResult?.sessionToken ?? null,
    }, 201)

  } catch (err) {
    try { if (typeof userId === 'string') await supabase.auth.admin.deleteUser(userId) } catch (cleanupErr) { logger.warn({ err: cleanupErr }, 'Registration cleanup: failed to delete user after error') }
    logger.error({ err }, 'Registration failed')
    return c.json({ error: 'Registration failed. Please try again.' }, 500)
  }
})
