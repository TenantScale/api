// ──────────────────────────────────────────────────────
// TenantScale — Prometheus Metrics Middleware
// ──────────────────────────────────────────────────────
// Records per‑request count, latency, status, and plan.
// Registered AFTER auth middleware so tenant context is
// available.  The /metrics endpoint itself is registered
// BEFORE rate‑limiters so monitoring tools are never
// blocked.
// ──────────────────────────────────────────────────────

import type { Context, Next } from 'hono'
import metrics, { collectMetrics } from '../lib/metrics.js'

/**
 * Hono middleware that records request count, latency, and status.
 * Should be registered AFTER auth middleware so tenant/plan context
 * is available.
 */
export async function metricsMiddleware(c: Context, next: Next) {
  const start = Date.now()
  const method = c.req.method
  const path = c.req.routePath ?? c.req.path

  await next()

  const duration = Date.now() - start
  const status = c.res.status

  // Extract plan from context if available (set by auth or rate-limit middleware)
  const plan = (c.get('planId') as string | undefined) ?? 'unknown'

  metrics.requestsTotal.inc({ method, path, status: String(status), plan })
  metrics.requestDuration.observe(duration, { method, path })
}

/**
 * GET /metrics — returns Prometheus‑formatted metrics.
 * Fires‑and‑forgets a DB call to set the active-tenant gauge.
 */
export async function metricsEndpoint(c: Context) {
  // Record active tenant count (fire and forget — best effort)
  try {
    const { supabase } = await import('../db/supabase')
    const { count } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true })
    if (typeof count === 'number') metrics.activeTenants.set(count)
  } catch {
    // best effort — don't block the metrics scrape
  }

  const output = collectMetrics()
  c.header('Content-Type', 'text/plain; charset=utf-8')
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
  return c.text(output)
}
