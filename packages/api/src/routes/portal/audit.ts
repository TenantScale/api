// ──────────────────────────────────────────────────────
// Portal: /portal/audit — Tenant audit log
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { supabase } from '../../db/supabase.js'
import { requirePortalSession, getSession } from '../../middleware/session-auth.js'
import type { PortalSession } from '../../middleware/session-auth.js'
import { supabaseError } from '../../lib/response.js'
import { getPaginationParams, paginationResponse } from '../../lib/pagination.js'

export const auditRoutes = new Hono()

// ── GET /portal/audit — Tenant audit log ──
auditRoutes.get('/portal/audit', requirePortalSession, async (c) => {
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
