// ──────────────────────────────────────────────────────
// Portal: /portal/me — Current user + tenant info
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { supabase } from '../../db/supabase.js'
import { requirePortalSession, getSession } from '../../middleware/session-auth.js'
import type { PortalSession } from '../../middleware/session-auth.js'

export const meRoutes = new Hono()

// ── GET /portal/me — Current user + tenant info ──
meRoutes.get('/portal/me', requirePortalSession, async (c) => {
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
