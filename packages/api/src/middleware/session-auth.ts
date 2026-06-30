// ──────────────────────────────────────────────────────
// Session auth middleware — validates portal sessions via @tenantscale/sdk
// ──────────────────────────────────────────────────────

import type { Context, Next } from 'hono'
import { getSdk } from '../lib/sdk'

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
 * via the SDK, and attaches the resolved portal session to context.
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
    const sdk = getSdk()
    const session = await sdk.validateSession(jwt)

    c.set('portalSession', {
      user_id: session.user_id,
      email: session.email,
      tenant_id: session.tenant_id,
      tenant_slug: session.tenant_slug,
      tenant_name: session.tenant_name,
      role: session.role,
      membership_id: session.membership_id,
      is_super_admin: session.is_super_admin,
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
