// ──────────────────────────────────────────────────────
// Audit logging — inlined from @tenantscale/sdk
// ──────────────────────────────────────────────────────

import type { Context } from 'hono'
import { supabase } from '../db/supabase.js'
import { logger } from './logger.js'

/** Audit event input shape */
export interface AuditEventInput {
  tenant_id: string
  actor_id?: string | null
  actor_type: 'user' | 'system' | 'admin_api' | 'admin_impersonation'
  action: string
  resource: string
  details?: Record<string, unknown>
  ip?: string | null
  user_agent?: string | null
}

/** Re-export from this file only */
export type { AuditEventInput as AuditEventInputType }

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
  const { error } = await supabase.from('audit_events').insert({
    tenant_id: input.tenant_id,
    actor_id: input.actor_id ?? null,
    actor_type: input.actor_type,
    action: input.action,
    resource: input.resource,
    details: input.details ?? {},
    ip: input.ip ?? null,
    user_agent: input.user_agent ?? null,
  })
  if (error) {
    logger.error({ error, input: { tenant_id: input.tenant_id, action: input.action } }, '[Audit] Failed to log audit event')
  }
}
