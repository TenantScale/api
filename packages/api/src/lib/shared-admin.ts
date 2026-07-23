// ──────────────────────────────────────────────────────
// Shared Admin Router Factory
// Consolidates near-identical routes from admin.ts and admin-portal.ts
// into a single configurable factory. Different auth strategies
// and actor identity extraction are injected as options.
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import type { MiddlewareHandler, Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { createHash, randomBytes } from 'node:crypto'
import { supabase } from '../db/supabase.js'
import {
  createTenantSchema,
  updateTenantSchema,
  createApiKeySchema,
  updatePlanSchema,
  createImpersonationSchema,
} from '../routes/schemas.js'
import { generateApiKey } from '../lib/api-key.js'
import { getPaginationParams, paginationResponse } from '../lib/pagination.js'
import { supabaseError } from '../lib/response.js'
import { logAuditEvent } from '../lib/audit.js'
import { dispatchWebhook } from '../lib/webhook-dispatcher.js'

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

/**
 * Information about the authenticated actor for audit events
 * and API key tracking.
 */
export interface AdminActor {
  /** Unique ID of the actor (user_id for portal, created_by for API key) */
  actorId?: string
  /**
   * Actor type for audit events.
   * Typical values: 'admin_api' (API-key routes), 'system' (portal routes).
   * Impersonation routes always use 'admin_impersonation' regardless.
   */
  actorType: string
  /** Email of the actor (used in audit event details for portal) */
  email?: string
}

export interface AdminRouteOptions {
  /**
   * Route path prefix, e.g. '/admin' or '/admin-portal'.
   * Routes are registered as `${prefix}/tenants`, `${prefix}/plans`, etc.
   */
  prefix: string

  /**
   * Auth middleware chain to apply to all protected routes.
   *
   * Example: [requireApiKey, requireScope('admin')]
   *          [requirePortalSession, requireSuperAdmin()]
   *
   * These are applied globally to the factory router via `router.use('*', ...)`,
   * so each route handler only needs its core logic.
   */
  auth: MiddlewareHandler[]

  /**
   * Extract actor identity from the Hono context for audit events
   * and API key created_by tracking.
   */
  getActor: (c: Context) => AdminActor

  /**
   * Include API key CRUD routes:
   *   GET    /tenants/:id/api-keys
   *   POST   /tenants/:id/api-keys
   *   DELETE /tenants/:id/api-keys/:keyId
   *   POST   /tenants/:id/api-keys/:keyId/rotate
   * Only used by the API-key-based admin routes.
   * @default false
   */
  includeApiKeyManagement?: boolean

  /**
   * Include DELETE /tenants/:id route.
   * @default true
   */
  includeDeleteTenant?: boolean

  /**
   * Include POST /impersonate/:id/revoke route.
   * Only used by the API-key-based admin routes.
   * @default false
   */
  includeImpersonationRevoke?: boolean

  /**
   * Fire dispatchWebhook events on tenant create/delete.
   * Only used by the API-key-based admin routes.
   * @default false
   */
  includeWebhookDispatch?: boolean
}

// ──────────────────────────────────────────────────────
// Factory
// ──────────────────────────────────────────────────────

export function createAdminRouter(opts: AdminRouteOptions): Hono {
  const router = new Hono()
  const {
    prefix,
    auth,
    getActor,
    includeApiKeyManagement = false,
    includeDeleteTenant = true,
    includeImpersonationRevoke = false,
    includeWebhookDispatch = false,
  } = opts

  // Apply auth middleware globally to all routes on this sub-router.
  for (const mw of auth) {
    router.use('*', mw)
  }

  // ════════════════════════════════════════════════════════════════
  // Tenant Management
  // ════════════════════════════════════════════════════════════════

  // ── GET {prefix}/tenants — List all tenants (paginated) ──
  router.get(`${prefix}/tenants`, async (c) => {
    const { page, limit, offset } = getPaginationParams(c)
    const search = c.req.query('search')

    let query = supabase
      .from('tenants')
      .select('id, name, slug, plan_id, is_active, created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (search) {
      query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`)
    }

    const { data: tenants, error, count } = await query

    if (error) return supabaseError(c, error)

    return c.json({
      tenants,
      pagination: paginationResponse(page, limit, count ?? 0),
    })
  })

  // ── GET {prefix}/tenants/:id — Tenant detail with stats ──
  router.get(`${prefix}/tenants/:id`, async (c) => {
    const id = c.req.param('id')

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !tenant) return c.json({ error: 'Tenant not found' }, 404)

    const { count: userCount } = await supabase
      .from('tenant_users')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', id)

    const { count: keyCount } = await supabase
      .from('api_keys')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', id)

    return c.json({ ...tenant, stats: { users: userCount ?? 0, api_keys: keyCount ?? 0 } })
  })

  // ── GET {prefix}/tenants/:id/users — List tenant users (unpaginated) ──
  router.get(`${prefix}/tenants/:id/users`, async (c) => {
    const tenantId = c.req.param('id')

    const { data: users, error } = await supabase
      .from('tenant_users')
      .select('id, user_id, role, joined_at')
      .eq('tenant_id', tenantId)
      .order('joined_at', { ascending: true })

    if (error) return supabaseError(c, error)

    // Fetch auth users with pagination (max 1000 per page).
    // For large deployments (>1000 auth users), consider caching auth user data
    // in a local user_profiles table and joining via tenant_users.user_id.
    const { data: authUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const userMap = new Map((authUsers?.users ?? []).map(u => [u.id, u.email ?? 'unknown']))

    // Warn if the auth user fetch likely hit the page limit
    const fetchedCount = authUsers?.users?.length ?? 0
    if (fetchedCount >= 1000) {
      c.header('X-Warning', 'Auth user list may be incomplete - consider using a user_profiles table for large deployments')
    }

    const enriched = users.map(u => ({ ...u, email: userMap.get(u.user_id) ?? 'unknown' }))

    return c.json({ users: enriched })
  })

  // ── POST {prefix}/tenants — Create tenant ──
  router.post(`${prefix}/tenants`, zValidator('json', createTenantSchema), async (c) => {
    const actor = getActor(c)
    const body = c.req.valid('json')

    const { data: existing } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', body.slug)
      .maybeSingle()

    if (existing) {
      return c.json({ error: 'A tenant with this slug already exists' }, 409)
    }

    // Validate the plan exists
    if (body.plan_id) {
      const { data: plan } = await supabase
        .from('plans')
        .select('id')
        .eq('id', body.plan_id)
        .single()

      if (!plan) {
        return c.json({
          error: `Invalid plan ID: "${body.plan_id}". Available plans: free, hobby, pro, scale, enterprise.`,
          code: 'INVALID_PLAN',
        }, 400)
      }
    }

    const { data: tenant, error } = await supabase
      .from('tenants')
      .insert({ name: body.name, slug: body.slug, plan_id: body.plan_id })
      .select()
      .single()

    if (error) return supabaseError(c, error)

    // Create a default API key for the new tenant
    const { rawKey, keyHash, keyPrefix } = generateApiKey()

    const apiKeyInsert: Record<string, unknown> = {
      tenant_id: tenant.id,
      label: 'Default',
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: ['read', 'write'],
    }
    if (actor.actorId) {
      apiKeyInsert.created_by = actor.actorId
    }

    await supabase.from('api_keys').insert(apiKeyInsert)

    // Audit event — merge in optional details per caller
    const auditDetails: Record<string, unknown> = {
      name: body.name,
      slug: body.slug,
      plan: body.plan_id,
    }
    if (actor.email) {
      auditDetails.created_by = actor.email
    }

    await logAuditEvent({
      tenant_id: tenant.id,
      actor_id: actor.actorId,
      actor_type: actor.actorType as 'admin_api' | 'system',
      action: 'tenant.created',
      resource: `tenant:${tenant.id}`,
      details: auditDetails,
    })

    if (includeWebhookDispatch) {
      dispatchWebhook('tenant.created', tenant.id, { name: body.name, slug: body.slug, plan: body.plan_id })
    }

    return c.json({ ...tenant, api_key: rawKey }, 201)
  })

  // ── PATCH {prefix}/tenants/:id — Update tenant ──
  router.patch(`${prefix}/tenants/:id`, zValidator('json', updateTenantSchema), async (c) => {
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

  // ── DELETE {prefix}/tenants/:id — Delete tenant (cascade) ──
  if (includeDeleteTenant) {
    router.delete(`${prefix}/tenants/:id`, async (c) => {
      const id = c.req.param('id')!
      const actor = getActor(c)

      // 1. Fetch tenant first (so we can return it after deletion)
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id, name, slug')
        .eq('id', id)
        .single()

      if (!tenant) {
        return c.json({ error: 'Tenant not found' }, 404)
      }

      // 2. Log audit event BEFORE delete (FK constraint)
      await logAuditEvent({
        tenant_id: id,
        actor_id: actor.actorId,
        actor_type: actor.actorType as 'admin_api' | 'system',
        action: 'tenant.deleted',
        resource: `tenant:${id}`,
        details: { name: tenant.name, slug: tenant.slug, deleted_by: actor.actorId },
      })

      // 3. Dispatch webhook (fire-and-forget, before delete so tenant still exists)
      if (includeWebhookDispatch) {
        dispatchWebhook('tenant.deleted', id, { name: tenant.name, slug: tenant.slug })
      }

      // 4. Delete tenant (ON DELETE CASCADE handles tenant_users, api_keys, etc.)
      const { error } = await supabase
        .from('tenants')
        .delete()
        .eq('id', id)

      if (error) return supabaseError(c, error)

      return c.json({
        success: true,
        deleted_tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      })
    })
  }

  // ════════════════════════════════════════════════════════════════
  // API Key Management (per tenant)
  // ════════════════════════════════════════════════════════════════

  if (includeApiKeyManagement) {
    // ── GET {prefix}/tenants/:id/api-keys — List API keys ──
    router.get(`${prefix}/tenants/:id/api-keys`, async (c) => {
      const tenantId = c.req.param('id')

      const { data: keys, error } = await supabase
        .from('api_keys')
        .select('id, label, key_prefix, scopes, is_active, last_used_at, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })

      if (error) return supabaseError(c, error)

      return c.json({ api_keys: keys })
    })

    // ── POST {prefix}/tenants/:id/api-keys — Create API key ──
    router.post(`${prefix}/tenants/:id/api-keys`, zValidator('json', createApiKeySchema), async (c) => {
      const tenantId = c.req.param('id')
      const body = c.req.valid('json')

      const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('id', tenantId)
        .single()

      if (!tenant) return c.json({ error: 'Tenant not found' }, 404)

      const { rawKey, keyHash, keyPrefix } = generateApiKey()

      const { data: keyRecord, error } = await supabase
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

      return c.json({ ...keyRecord, raw_key: rawKey }, 201)
    })

    // ── DELETE {prefix}/tenants/:id/api-keys/:keyId — Revoke API key ──
    router.delete(`${prefix}/tenants/:id/api-keys/:keyId`, async (c) => {
      const { id: tenantId, keyId } = c.req.param()

      const { data: keyRecord, error } = await supabase
        .from('api_keys')
        .update({ is_active: false })
        .eq('id', keyId)
        .eq('tenant_id', tenantId)
        .select()
        .single()

      if (error) return supabaseError(c, error)
      if (!keyRecord) return c.json({ error: 'API key not found' }, 404)

      return c.json({
        success: true,
        revoked_key: { id: keyRecord.id, label: keyRecord.label, key_prefix: keyRecord.key_prefix },
      })
    })

    // ── POST {prefix}/tenants/:id/api-keys/:keyId/rotate — Rotate API key ──
    router.post(`${prefix}/tenants/:id/api-keys/:keyId/rotate`, async (c) => {
      const { id: tenantId, keyId } = c.req.param()

      // Fetch the existing API key
      const { data: existingKey, error: fetchError } = await supabase
        .from('api_keys')
        .select('*')
        .eq('id', keyId)
        .eq('tenant_id', tenantId)
        .single()

      if (fetchError || !existingKey) {
        return c.json({ error: 'API key not found' }, 404)
      }

      // Generate a new key value
      const { rawKey, keyHash } = generateApiKey()

      // Update the key record — preserve key_prefix and update hash only.
      // Intentionally do NOT update created_at — rotation is not creation.
      const { data: updatedKey, error: updateError } = await supabase
        .from('api_keys')
        .update({
          key_hash: keyHash,
        })
        .eq('id', keyId)
        .eq('tenant_id', tenantId)
        .select()
        .single()

      if (updateError || !updatedKey) {
        return c.json({ error: updateError?.message ?? 'Failed to rotate API key' }, 500)
      }

      // Log audit event
      await logAuditEvent({
        tenant_id: tenantId,
        actor_type: 'admin_api',
        action: 'api_key.rotated',
        resource: `api_key:${keyId}`,
        details: { key_label: existingKey.label, key_prefix: existingKey.key_prefix },
      })

      return c.json({ ...updatedKey, raw_key: rawKey, warning: 'Save this key' })
    })
  }

  // ════════════════════════════════════════════════════════════════
  // Plans
  // ════════════════════════════════════════════════════════════════

  // ── GET {prefix}/plans — List all plans ──
  router.get(`${prefix}/plans`, async (c) => {
    const { data: plans, error } = await supabase
      .from('plans')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) return supabaseError(c, error)

    return c.json({ plans })
  })

  // ── PATCH {prefix}/plans/:id — Update a plan ──
  router.patch(`${prefix}/plans/:id`, zValidator('json', updatePlanSchema), async (c) => {
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const { data: plan, error } = await supabase
      .from('plans')
      .update(body)
      .eq('id', id)
      .select()
      .single()

    if (error) return supabaseError(c, error)
    if (!plan) return c.json({ error: 'Plan not found' }, 404)

    return c.json(plan)
  })

  // ════════════════════════════════════════════════════════════════
  // Impersonation
  // ════════════════════════════════════════════════════════════════

  // ── POST {prefix}/impersonate — Impersonate a user ──
  router.post(`${prefix}/impersonate`, zValidator('json', createImpersonationSchema), async (c) => {
    const actor = getActor(c)
    const body = c.req.valid('json')

    // Verify target user exists and belongs to the target tenant
    const { data: membership } = await supabase
      .from('tenant_users')
      .select('id, role')
      .eq('user_id', body.target_user_id)
      .eq('tenant_id', body.target_tenant_id)
      .maybeSingle()

    if (!membership) {
      return c.json({ error: 'Target user not found in this tenant' }, 404)
    }

    // Generate one-time token
    const token = `imp_${randomBytes(32).toString('hex')}`
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + body.expires_in_minutes * 60_000)

    const { data: session, error } = await supabase
      .from('impersonation_sessions')
      .insert({
        admin_user_id: actor.actorId ?? null,
        target_user_id: body.target_user_id,
        target_tenant_id: body.target_tenant_id,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single()

    if (error) return supabaseError(c, error)

    // Log the impersonation start
    await logAuditEvent({
      tenant_id: body.target_tenant_id,
      actor_id: actor.actorId,
      actor_type: 'admin_impersonation',
      action: 'user.impersonated',
      resource: `user:${body.target_user_id}`,
      details: {
        impersonation_session_id: session.id,
        expires_at: expiresAt.toISOString(),
      },
    })

    return c.json({
      token,
      target_user_id: body.target_user_id,
      target_tenant_id: body.target_tenant_id,
      expires_at: expiresAt.toISOString(),
      redirect_url: `/api/auth/impersonate?token=${token}`,
    })
  })

  // ── POST {prefix}/impersonate/:id/revoke — Revoke impersonation ──
  if (includeImpersonationRevoke) {
    router.post(`${prefix}/impersonate/:id/revoke`, async (c) => {
      const id = c.req.param('id')

      const { error } = await supabase
        .from('impersonation_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)

      if (error) return supabaseError(c, error)

      return c.json({ success: true })
    })
  }

  // ════════════════════════════════════════════════════════════════
  // Cross-tenant Audit Log
  // ════════════════════════════════════════════════════════════════

  // ── GET {prefix}/audit — Cross-tenant audit log ──
  router.get(`${prefix}/audit`, async (c) => {
    const { page, limit, offset } = getPaginationParams(c)
    const tenantId = c.req.query('tenant_id')
    const action = c.req.query('action')

    let query = supabase
      .from('audit_events')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (tenantId) query = query.eq('tenant_id', tenantId)
    if (action) query = query.eq('action', action)

    const { data: events, error, count } = await query

    if (error) return supabaseError(c, error)

    return c.json({
      events,
      pagination: paginationResponse(page, limit, count ?? 0),
    })
  })

  return router
}
