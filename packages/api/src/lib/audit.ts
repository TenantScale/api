// ──────────────────────────────────────────────────────
// Audit logging — delegates to @tenantscale/sdk
// ──────────────────────────────────────────────────────

import type { AuditEventInput } from '@tenantscale/sdk'
import { getSdk } from './sdk'
import type { Context } from 'hono'

/**
 * Extract client IP from a Hono request context.
 * Checks x-forwarded-for first (supports comma-separated lists),
 * falls back to x-real-ip, then unknown.
 */
export function getClientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) {
    const firstIp = forwarded.split(',')[0]?.trim()
    if (firstIp) return firstIp
  }
  return c.req.header('x-real-ip') ?? 'unknown'
}

/**
 * Log an audit event to the database.
 * Fire-and-forget — never blocks the response.
 */
export async function logAuditEvent(input: AuditEventInput): Promise<void> {
  return getSdk().logAuditEvent(input)
}

// Re-export type for convenience
export type { AuditEventInput }
