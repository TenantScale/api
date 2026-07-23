// ──────────────────────────────────────────────────────
// Portal routes — session-based API for the Customer Portal
// All routes require a valid Supabase session JWT
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { createHash, randomBytes } from 'node:crypto'
import { supabase } from '../db/supabase.js'
import {
  inviteUserSchema,
  updateRoleSchema,
  transferOwnershipSchema,
  updateSettingsSchema,
  createPortalApiKeySchema,
  registerSchema,
  portalTenantCreateSchema,
} from './schemas.js'
import { requirePortalSession, requirePortalRole, getSession } from '../middleware/session-auth.js'
import type { PortalSession } from '../middleware/session-auth.js'
import { invalidatePlanCache } from '../lib/plan-store.js'
import { dispatchWebhook } from '../lib/webhook-dispatcher.js'
import { generateApiKey } from '../lib/api-key.js'
import { getPaginationParams, paginationResponse } from '../lib/pagination.js'
import { supabaseError } from '../lib/response.js'
import { getClientIp } from '../lib/audit.js'
import { logAuditEvent } from '../lib/audit.js'
import { logger } from '../lib/logger.js'
import { checkIpCreationLimit } from '../middleware/rate-limit.js'

export const portalRoutes = new Hono()

// ── GET /portal/me — Current user + tenant info ──
portalRoutes.get('/portal/me', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)

  const baseResponse: Record<string, unknown> = {
    user: {
      id: session.user_id,
      email: session.email,
      role: session.role,
      is_super_admin: session.is_super_admin,
    },
  }

  if (!session.tenant_id) {
    return c.json({
      ...baseResponse,
      tenant: null,
      limits: null,
      features: {},
      deployment: { mode: process.env.DEPLOYMENT_MODE ?? 'self_hosted' },
    })
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', session.tenant_id)
    .single()

  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  const { data: plan } = await supabase
    .from('plans')
    .select('features, name, max_users')
    .eq('id', tenant.plan_id)
    .single()

  const features = {
    ...((plan?.features ?? {}) as Record<string, unknown>),
    ...((tenant.features ?? {}) as Record<string, unknown>),
  }

  const { count: userCount } = await supabase
    .from('tenant_users')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', session.tenant_id)

  return c.json({
    ...baseResponse,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan_id,
      plan_name: plan?.name ?? 'Free',
      features,
      settings: tenant.settings,
      config: tenant.config,
      created_at: tenant.created_at,
    },
    limits: {
      max_users: plan?.max_users ?? null,
      current_users: userCount ?? 0,
    },
  })
})

// ── GET /portal/users — List tenant users (paginated) ──
portalRoutes.get('/portal/users', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)
  const { page, limit, offset } = getPaginationParams(c)

  const { data: users, error, count } = await supabase
    .from('tenant_users')
    .select('id, user_id, role, joined_at, invited_by', { count: 'exact' })
    .eq('tenant_id', session.tenant_id)
    .order('joined_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) return supabaseError(c, error)

  // Fetch auth users with pagination (max 1000 per page).
  // For large deployments (>1000 auth users), consider caching auth user data
  // in a local user_profiles table and joining via tenant_users.user_id.
  const { data: authUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const userMap = new Map((authUsers?.users ?? []).map(u => [u.id, u.email ?? null]))

  // Warn if the auth user fetch likely hit the page limit
  const fetchedCount = authUsers?.users?.length ?? 0
  if (fetchedCount >= 1000) {
    c.header('X-Warning', 'Auth user list may be incomplete - consider using a user_profiles table for large deployments')
  }

  const enriched = users.map(u => ({
    ...u,
    email: userMap.get(u.user_id) ?? null,
    is_self: u.user_id === session.user_id,
  }))

  return c.json({ users: enriched })
})

// ── POST /portal/users/invite — Invite a user to the tenant ──
portalRoutes.post('/portal/users/invite', requirePortalSession, requirePortalRole('owner', 'admin'), zValidator('json', inviteUserSchema), async (c) => {
  const session: PortalSession = getSession(c)
  const body = c.req.valid('json')

  const { data: authUsers } = await supabase.auth.admin.listUsers()
  const targetUser = (authUsers?.users ?? []).find(u => u.email === body.email)

  if (!targetUser) {
    return c.json({ error: 'No user found with this email. They must sign up first.' }, 404)
  }

  const { data: existing } = await supabase
    .from('tenant_users')
    .select('id')
    .eq('tenant_id', session.tenant_id)
    .eq('user_id', targetUser.id)
    .maybeSingle()

  if (existing) {
    return c.json({ error: 'User is already a member of this tenant' }, 409)
  }

  // Check max_users limit
  const { data: tenant } = await supabase
    .from('tenants')
    .select('plan_id')
    .eq('id', session.tenant_id)
    .single()

  const { data: plan } = await supabase
    .from('plans')
    .select('max_users')
    .eq('id', tenant?.plan_id)
    .single()

  if (plan?.max_users) {
    const { count } = await supabase
      .from('tenant_users')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', session.tenant_id)

    if (count && count >= plan.max_users) {
      return c.json({ error: `Plan limit reached (${plan.max_users} users). Upgrade to add more.` }, 403)
    }
  }

  const { data: membership, error } = await supabase
    .from('tenant_users')
    .insert({
      tenant_id: session.tenant_id,
      user_id: targetUser.id,
      role: body.role,
      invited_by: session.membership_id,
    })
    .select()
    .single()

  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'user.invited',
    resource: `user:${targetUser.id}`,
    details: { invited_email: body.email, role: body.role, invited_by: session.email },
  })

  return c.json({ ...membership, email: body.email }, 201)
})

// ── DELETE /portal/users/:id — Remove user from tenant ──
portalRoutes.delete('/portal/users/:id', requirePortalSession, requirePortalRole('owner', 'admin'), async (c) => {
  const session: PortalSession = getSession(c)
  const membershipId = c.req.param('id')

  const { data: target } = await supabase
    .from('tenant_users')
    .select('*')
    .eq('id', membershipId)
    .eq('tenant_id', session.tenant_id)
    .single()

  if (!target) return c.json({ error: 'User not found in this tenant' }, 404)
  if (target.role === 'owner') return c.json({ error: 'Cannot remove the tenant owner' }, 403)
  if (target.user_id === session.user_id) return c.json({ error: 'Use the leave endpoint to remove yourself' }, 400)

  const { error } = await supabase.from('tenant_users').delete().eq('id', membershipId)
  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'user.removed',
    resource: `user:${target.user_id}`,
    details: { removed_by: session.email },
  })

  return c.json({ success: true })
})

// ── PATCH /portal/users/:id/role — Change user role ──
portalRoutes.patch('/portal/users/:id/role', requirePortalSession, requirePortalRole('owner', 'admin'), zValidator('json', updateRoleSchema), async (c) => {
  const session: PortalSession = getSession(c)
  const membershipId = c.req.param('id')
  const body = c.req.valid('json')

  const { data: target } = await supabase
    .from('tenant_users')
    .select('*')
    .eq('id', membershipId)
    .eq('tenant_id', session.tenant_id)
    .single()

  if (!target) return c.json({ error: 'User not found in this tenant' }, 404)
  if (target.role === 'owner') return c.json({ error: 'Cannot change the tenant owner role' }, 403)

  const { data: updated, error } = await supabase
    .from('tenant_users')
    .update({ role: body.role })
    .eq('id', membershipId)
    .select()
    .single()

  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'user.role_changed',
    resource: `user:${target.user_id}`,
    details: { from_role: target.role, to_role: body.role, changed_by: session.email },
  })

  return c.json(updated)
})

// ── POST /portal/leave — Leave the current tenant ──
portalRoutes.post('/portal/leave', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)

  if (session.role === 'owner') {
    return c.json({ error: 'Transfer ownership before leaving, or delete the tenant' }, 403)
  }

  const { error } = await supabase.from('tenant_users').delete().eq('id', session.membership_id)
  if (error) return supabaseError(c, error)

  return c.json({ success: true })
})

// ── GET /portal/api-keys — List API keys for the tenant ──
portalRoutes.get('/portal/api-keys', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)

  const { data: keys, error } = await supabase
    .from('api_keys')
    .select('id, label, key_prefix, scopes, is_active, expires_at, last_used_at, created_at, created_by')
    .eq('tenant_id', session.tenant_id)
    .order('created_at', { ascending: false })

  if (error) return supabaseError(c, error)

  return c.json({ api_keys: keys })
})

// ── POST /portal/api-keys — Create a new API key ──
portalRoutes.post('/portal/api-keys', requirePortalSession, requirePortalRole('owner', 'admin'), zValidator('json', createPortalApiKeySchema), async (c) => {
  const session: PortalSession = getSession(c)
  const body = c.req.valid('json')

  const { rawKey, keyHash, keyPrefix } = generateApiKey()

  const { data: apiKey, error } = await supabase
    .from('api_keys')
    .insert({
      tenant_id: session.tenant_id,
      label: body.label,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: body.scopes,
      created_by: session.user_id,
    })
    .select()
    .single()

  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'api_key.created',
    resource: `api_key:${apiKey.id}`,
    details: { label: body.label, key_prefix: keyPrefix, created_by: session.email },
  })

  return c.json({ ...apiKey, raw_key: rawKey }, 201)
})

// ── DELETE /portal/api-keys/:id — Revoke an API key ──
portalRoutes.delete('/portal/api-keys/:id', requirePortalSession, requirePortalRole('owner', 'admin'), async (c) => {
  const session: PortalSession = getSession(c)
  const keyId = c.req.param('id')

  const { data: key } = await supabase
    .from('api_keys')
    .select('*')
    .eq('id', keyId)
    .eq('tenant_id', session.tenant_id)
    .single()

  if (!key) return c.json({ error: 'API key not found' }, 404)

  const { error } = await supabase
    .from('api_keys')
    .update({ is_active: false })
    .eq('id', keyId)

  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'api_key.revoked',
    resource: `api_key:${keyId}`,
    details: { label: key.label, revoked_by: session.email },
  })

  return c.json({ success: true })
})

// ── GET /portal/audit — Tenant audit log ──
portalRoutes.get('/portal/audit', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)
  const { page, limit, offset } = getPaginationParams(c)
  const action = c.req.query('action')

  let query = supabase
    .from('audit_events')
    .select('*', { count: 'exact' })
    .eq('tenant_id', session.tenant_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (action) query = query.eq('action', action)

  if (session.role && !['owner', 'admin'].includes(session.role)) {
    query = query.eq('actor_id', session.user_id)
  }

  const { data: events, error, count } = await query

  if (error) return supabaseError(c, error)

  return c.json({
    events,
    pagination: paginationResponse(page, limit, count ?? 0),
  })
})

// ── PATCH /portal/settings — Update tenant settings ──
portalRoutes.patch('/portal/settings', requirePortalSession, requirePortalRole('owner', 'admin'), zValidator('json', updateSettingsSchema), async (c) => {
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
portalRoutes.post('/portal/transfer-ownership', requirePortalSession, requirePortalRole('owner'), zValidator('json', transferOwnershipSchema), async (c) => {
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

// ════════════════════════════════════════════════════════════════
// User's Tenants — list and create (authenticated)
// ════════════════════════════════════════════════════════════════

// ── GET /portal/tenants — List all tenants the current user belongs to ──
portalRoutes.get('/portal/tenants', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)

  const { data: memberships, error } = await supabase
    .from('tenant_users')
    .select('id, role, joined_at, tenant:tenants(id, name, slug, plan_id, is_active, created_at)')
    .eq('user_id', session.user_id)
    .order('joined_at', { ascending: false })

  if (error) return supabaseError(c, error)

  const tenants = (memberships ?? []).map((m: Record<string, unknown>) => {
    const tenant = m.tenant as Record<string, unknown> ?? {}
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
// BILLING ENFORCEMENT: Portal-created tenants always get the Free plan.
// max_tenants is checked against the user's total tenant count.
portalRoutes.post('/portal/tenants', requirePortalSession, zValidator('json', portalTenantCreateSchema), async (c) => {
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

  const maxTenants = freePlan.max_tenants ?? 3 // fallback to 3
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
    // Rollback tenant creation on failure
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
    // Non-fatal — key can be generated later
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

  // 8. Invalidate plan cache for this tenant so limits refresh
  invalidatePlanCache(tenant.id)

  return c.json({
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    plan: tenant.plan_id,
    api_key: rawKey,
  }, 201)
})

// ── POST /portal/register — Sign up a new user + create their tenant ──
portalRoutes.post('/portal/register', zValidator('json', registerSchema), async (c) => {
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

  // 2. Create the user via Supabase Auth
  const { data: authUser, error: signUpError } = await supabase.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { tenant_name: body.tenant_name },
  })

  if (signUpError) return c.json({ error: signUpError.message }, 400)
  if (!authUser.user) return c.json({ error: 'Failed to create user' }, 500)

  const userId = authUser.user.id

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
    const { data: sessionData } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    })

    return c.json({
      success: true,
      user: { id: userId, email: body.email },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      api_key: rawKey,
      session: sessionData?.session ?? null,
    }, 201)

  } catch (err) {
    // Clean up any created resources on unexpected failure
    try { if (typeof userId === 'string') await supabase.auth.admin.deleteUser(userId) } catch (cleanupErr) { logger.warn({ err: cleanupErr }, 'Registration cleanup: failed to delete user after error') }
    logger.error({ err }, 'Registration failed')
    return c.json({ error: 'Registration failed. Please try again.' }, 500)
  }
})
