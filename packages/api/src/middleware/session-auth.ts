// ──────────────────────────────────────────────────────
// Session auth middleware — validates portal sessions via Supabase
// ──────────────────────────────────────────────────────

import type { Context, Next } from 'hono'
import { supabase } from '../db/supabase.js'

// ── Portal session type stored in Hono context ──

export interface PortalSession {
  user_id: string
  email: string
  tenant_id: string | null
  tenant_slug: string | null
  tenant_name: string | null
  role: string | null
  membership_id: string | null
  is_super_admin: boolean
}

// ── Middleware ──

/**
 * Hono middleware that validates a portal session JWT.
 *
 * Reads Authorization: Bearer <token>, validates the session
 * via Supabase Auth, and attaches the resolved portal session to context.
 */
export async function requirePortalSession(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }

  const jwt = authHeader.slice(7).trim()
  if (!jwt) {
    return c.json({ error: 'Empty token' }, 401)
  }

  try {
    // Validate the JWT via Supabase Auth
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)

    if (authError || !user) {
      return c.json({ error: 'Invalid or expired session' }, 401)
    }

    const userId = user.id
    const email = user.email ?? ''

    // Check if user is a platform admin (super admin)
    const { data: platformAdmin } = await supabase
      .from('platform_admins')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()

    const isSuperAdmin = !!platformAdmin

    // Resolve tenant membership
    const { data: membership } = await supabase
      .from('tenant_users')
      .select('id, role, tenant:tenants(id, name, slug)')
      .eq('user_id', userId)
      .maybeSingle()

    const membershipData = membership as unknown as {
      id: string
      role: string
      tenant: { id: string; name: string; slug: string }
    } | null

    c.set('portalSession', {
      user_id: userId,
      email,
      tenant_id: membershipData?.tenant?.id ?? null,
      tenant_slug: membershipData?.tenant?.slug ?? null,
      tenant_name: membershipData?.tenant?.name ?? null,
      role: membershipData?.role ?? null,
      membership_id: membershipData?.id ?? null,
      is_super_admin: isSuperAdmin,
    } satisfies PortalSession)

    await next()
  } catch (err) {
    const err_ = err as { statusCode?: number; message?: string; code?: string }
    const status = err_.statusCode ?? 401
    return c.json({
      error: err_.message ?? 'Invalid session',
      code: err_.code ?? 'SESSION_INVALID',
    }, status as 401 | 403)
  }
}

/**
 * Middleware factory that restricts to specific portal roles.
 * Must be placed after requirePortalSession.
 */
export function requirePortalRole(...roles: string[]) {
  return async (c: Context, next: Next) => {
    const session: PortalSession | undefined = c.get('portalSession')
    if (!session) {
      return c.json({ error: 'Portal session required' }, 401)
    }

    if (!session.role || !roles.includes(session.role)) {
      return c.json({
        error: `This endpoint requires one of these roles: ${roles.join(', ')}`,
      }, 403)
    }

    await next()
  }
}

/**
 * Get the PortalSession from Hono context.
 */
export function getSession(c: Context): PortalSession {
  return c.get('portalSession')
}

/**
 * Middleware factory that requires super admin access.
 * Must be placed after requirePortalSession.
 */
export function requireSuperAdmin() {
  return async (c: Context, next: Next) => {
    const session: PortalSession | undefined = c.get('portalSession')
    if (!session) {
      return c.json({ error: 'Portal session required' }, 401)
    }

    if (!session.is_super_admin) {
      return c.json({ error: 'Super admin access required' }, 403)
    }

    await next()
  }
}
