// ──────────────────────────────────────────────────────
// Admin Portal routes — session-based super_admin access
// Uses shared factory for tenant/plan/audit/impersonation routes.
// All routes are guarded by requirePortalSession + requireSuperAdmin().
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { createAdminRouter } from '../lib/shared-admin'
import type { AdminActor } from '../lib/shared-admin'
import { requirePortalSession, requireSuperAdmin, getSession } from '../middleware/session-auth'
import type { PortalSession } from '../middleware/session-auth'

export const adminPortalRoutes = new Hono()

// ════════════════════════════════════════════════════════════════
// Shared routes from factory
// ════════════════════════════════════════════════════════════════

const sharedRouter = createAdminRouter({
  prefix: '/admin-portal',
  auth: [requirePortalSession, requireSuperAdmin()],
  getActor: (c): AdminActor => {
    const session: PortalSession = getSession(c)
    return {
      actorId: session.user_id,
      actorType: 'system',
      email: session.email,
    }
  },
  includeApiKeyManagement: false,
  includeDeleteTenant: false,
  includeImpersonationRevoke: false,
  includeWebhookDispatch: false,
})

adminPortalRoutes.route('/', sharedRouter)
