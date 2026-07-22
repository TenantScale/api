// ──────────────────────────────────────────────────────
// Admin routes — API-key-based admin access
// Uses shared factory for tenant/plan/audit/impersonation routes,
// keeps only the unique routes here (auth/impersonate redeem).
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { supabase } from '../db/supabase'
import { createAdminRouter } from '../lib/shared-admin'
import type { AdminActor } from '../lib/shared-admin'
import { requireApiKey, requireScope } from '../middleware/auth'
import type { ApiKeyContext } from '../env'
import { createDdosGuard } from '../middleware/rate-limit'

export const adminRoutes = new Hono()

// ════════════════════════════════════════════════════════════════
// Shared routes from factory
// ════════════════════════════════════════════════════════════════

const sharedRouter = createAdminRouter({
  prefix: '/admin',
  auth: [requireApiKey, requireScope('admin')],
  getActor: (c): AdminActor => {
    const apiKey: ApiKeyContext = c.get('apiKey')
    return {
      actorId: apiKey.created_by ?? undefined,
      actorType: 'admin_api',
    }
  },
  includeApiKeyManagement: true,
  includeDeleteTenant: true,
  includeImpersonationRevoke: true,
  includeWebhookDispatch: true,
})

adminRoutes.route('/', sharedRouter)

// ════════════════════════════════════════════════════════════════
// Unique routes (not shared with admin-portal)
// ════════════════════════════════════════════════════════════════

// ── Redeem impersonation token ──
// No auth — token itself is the credential
// IP-based rate limiting prevents brute-force attacks against the token
const impersonateGuard = createDdosGuard({ maxRequests: 10, windowMs: 60_000 })

/**
 * POST /admin/auth/impersonate
 *
 * Redeem a one-time impersonation token issued for a support/admin
 * impersonation session. The token itself is the credential — there
 * is no separate API key or session auth on this endpoint.
 *
 * Auth: none. Protected instead by IP-based rate limiting
 * (`createDdosGuard`, max 10 requests/minute) to prevent brute-forcing
 * the token.
 *
 * Input (JSON body):
 * - `token` (string, required) — the raw impersonation token to redeem
 *
 * Response: `200 OK`
 * ```
 * {
 *   "success": true,
 *   "target_user_id": string,
 *   "target_tenant_id": string,
 *   "expires_at": string // ISO date
 * }
 * ```
 *
 * Errors:
 * - `400` — `token` missing from request body
 * - `401` — token not found, already revoked, or expired
 */
adminRoutes.post('/auth/impersonate', impersonateGuard, async (c) => {
  const { token } = await c.req.json<{ token: string }>()

  if (!token) {
    return c.json({ error: 'Token is required' }, 400)
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')

  const { data: session, error } = await supabase
    .from('impersonation_sessions')
    .select('*')
    .eq('token_hash', tokenHash)
    .single()

  if (error || !session) {
    return c.json({ error: 'Invalid impersonation token' }, 401)
  }

  if (session.revoked_at) {
    return c.json({ error: 'Impersonation token has been revoked' }, 401)
  }

  if (new Date(session.expires_at) < new Date()) {
    return c.json({ error: 'Impersonation token has expired' }, 401)
  }

  return c.json({
    success: true,
    target_user_id: session.target_user_id,
    target_tenant_id: session.target_tenant_id,
    expires_at: session.expires_at,
  })
})
