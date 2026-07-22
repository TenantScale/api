import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { supabase } from '../db/supabase'
import { requireApiKey } from '../middleware/auth'
import { requirePortalSession, getSession } from '../middleware/session-auth'
import type { PortalSession } from '../middleware/session-auth'
import { supabaseError } from '../lib/response'
import { logger } from '../lib/logger'

export const analyticsRoutes = new Hono()

// ── Schema ──

/**
 * Query params accepted by the usage analytics endpoints.
 *
 * @property metric      Optional metric name to filter results to a single metric.
 *                        When omitted, all metrics are returned.
 * @property period       Lookback window. One of `7d`, `30d`, `90d`. Defaults to `30d`.
 * @property granularity  Bucket size used to aggregate results. One of `day`, `week`,
 *                        `month`. Defaults to `day`.
 */
const usageQuerySchema = z.object({
  metric: z.string().optional(),
  period: z.enum(['7d', '30d', '90d']).default('30d'),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
})

// ── Portal: get usage analytics for the tenant's session ──

/**
 * GET /portal/analytics/usage
 *
 * Returns usage analytics for the tenant associated with the caller's portal
 * session, aggregated into time buckets.
 *
 * @auth Requires a valid portal session (`requirePortalSession`). The tenant
 *       is resolved from the session — callers cannot query another tenant.
 *
 * @query {string} [metric] - Optional metric name to filter to.
 * @query {'7d'|'30d'|'90d'} [period=30d] - Lookback window.
 * @query {'day'|'week'|'month'} [granularity=day] - Aggregation bucket size.
 *
 * @returns {200} JSON body:
 *   ```
 *   {
 *     series: Array<{
 *       metric: string,
 *       data: Array<{ date: string, total: number }>
 *     }>,
 *     period: string,
 *     granularity: string,
 *     since: string // ISO timestamp marking the start of the lookback window
 *   }
 *   ```
 *
 * @errors
 *   - 400 `{ error: 'No tenant associated' }` — session has no tenant_id.
 *   - 400 — query validation failure (handled by `zValidator`, e.g. invalid
 *     `period`/`granularity` value).
 *   - 500 — Supabase query error (see `supabaseError`).
 */
analyticsRoutes.get('/portal/analytics/usage', requirePortalSession, zValidator('query', usageQuerySchema), async (c) => {
  const session: PortalSession = getSession(c)
  const { metric, period, granularity } = c.req.valid('query')

  if (!session.tenant_id) {
    return c.json({ error: 'No tenant associated' }, 400)
  }

  const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
  const days = daysMap[period] ?? 30
  const since = new Date(Date.now() - days * 86400000).toISOString()

  let query = supabase
    .from('usage_events')
    .select('metric, value, created_at', { count: 'exact' })
    .eq('tenant_id', session.tenant_id)
    .gte('created_at', since)
    .order('created_at', { ascending: true })

  if (metric) query = query.eq('metric', metric)

  const { data: events, error } = await query
  if (error) return supabaseError(c, error)

  // Aggregate into time buckets
  type RawEvent = { metric: string; value: number; created_at: string }
  const raw = (events ?? []) as unknown as RawEvent[]

  // Group by metric and time bucket
  const buckets = new Map<string, Map<string, number>>() // metric -> bucketKey -> total
  for (const ev of raw) {
    const m = ev.metric
    if (!buckets.has(m)) buckets.set(m, new Map())

    let bucketKey: string
    const d = new Date(ev.created_at)
    if (granularity === 'day') bucketKey = d.toISOString().slice(0, 10)
    else if (granularity === 'week') {
      const startOfWeek = new Date(d)
      startOfWeek.setDate(d.getDate() - d.getDay())
      bucketKey = startOfWeek.toISOString().slice(0, 10)
    } else {
      bucketKey = d.toISOString().slice(0, 7)
    }

    const metricBuckets = buckets.get(m)!
    metricBuckets.set(bucketKey, (metricBuckets.get(bucketKey) ?? 0) + (ev.value ?? 1))
  }

  // Format response
  const series = Array.from(buckets.entries()).map(([metricName, bucketMap]) => ({
    metric: metricName,
    data: Array.from(bucketMap.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }))

  return c.json({ series, period, granularity, since })
})

// ── Admin: get usage analytics for any tenant (API key + admin scope) ──

/**
 * GET /admin/tenants/:id/analytics/usage
 *
 * Returns usage analytics for an arbitrary tenant, identified by `:id`.
 * Intended for internal/admin tooling rather than tenant-facing portals.
 *
 * @auth Requires a valid API key (`requireApiKey`).
 *
 * @param {string} id - Tenant ID, taken from the URL path.
 * @query {string} [metric] - Optional metric name to filter to.
 * @query {'7d'|'30d'|'90d'} [period=30d] - Lookback window. Unlike the portal
 *   endpoint, this is read as a raw query string (not validated against the
 *   enum), so an unrecognized value silently falls back to 30 days.
 *
 * @returns {200} JSON body:
 *   ```
 *   {
 *     series: Array<{
 *       metric: string,
 *       data: Array<{ date: string, total: number }>
 *     }>,
 *     period: string,
 *     since: string // ISO timestamp marking the start of the lookback window
 *   }
 *   ```
 *   Note: buckets are always aggregated by day (no `granularity` param here).
 *
 * @errors
 *   - 401/403 — missing or invalid API key (handled by `requireApiKey`).
 *   - 500 — Supabase query error (see `supabaseError`).
 */
analyticsRoutes.get('/admin/tenants/:id/analytics/usage', requireApiKey, async (c) => {
  const tenantId = c.req.param('id')
  const metric = c.req.query('metric')
  const period = c.req.query('period') ?? '30d'

  const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
  const days = daysMap[period] ?? 30
  const since = new Date(Date.now() - days * 86400000).toISOString()

  let query = supabase
    .from('usage_events')
    .select('metric, value, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .order('created_at', { ascending: true })

  if (metric) query = query.eq('metric', metric)

  const { data: events, error } = await query
  if (error) return supabaseError(c, error)

  type RawEvent = { metric: string; value: number; created_at: string }
  const raw = (events ?? []) as unknown as RawEvent[]
  const buckets = new Map<string, Map<string, number>>()

  for (const ev of raw) {
    const m = ev.metric
    if (!buckets.has(m)) buckets.set(m, new Map())
    const dateKey = ev.created_at.slice(0, 10)
    const metricBuckets = buckets.get(m)!
    metricBuckets.set(dateKey, (metricBuckets.get(dateKey) ?? 0) + (ev.value ?? 1))
  }

  const series = Array.from(buckets.entries()).map(([metricName, bucketMap]) => ({
    metric: metricName,
    data: Array.from(bucketMap.entries())
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }))

  return c.json({ series, period, since })
})
