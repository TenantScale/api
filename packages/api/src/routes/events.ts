// ──────────────────────────────────────────────────────
// Usage Events routes — metering / usage tracking
// ──────────────────────────────────────────────────────
// Events are stored in the dedicated `usage_events` table,
// separate from audit_logs. Usage data is retained indefinitely
// for billing analytics and doesn't follow audit retention policies.
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { supabase } from '../db/supabase'
import { trackEventSchema } from './schemas'
import { requireApiKey } from '../middleware/auth'
import { supabaseError } from '../lib/response'
import { logger } from '../lib/logger'

const DEFAULT_SUMMARY_WINDOW_DAYS = 30

export const eventRoutes = new Hono()

/**
 * POST /events
 *
 * Receive a usage event from the SDK and store it in the `usage_events`
 * table for later aggregation (billing analytics).
 *
 * Auth: requires a valid API key (`requireApiKey`). The event is
 * attributed to the tenant tied to the API key.
 *
 * Input (JSON body, validated against `trackEventSchema`):
 * - `metric` (string, 1-100 chars, required) — name of the metric being tracked
 * - `value` (number, optional, default `1`) — amount to record for this event
 * - `properties` (object, optional, default `{}`) — arbitrary metadata for the event
 *
 * Response: `202 Accepted`
 * ```
 * { "success": true }
 * ```
 *
 * Errors:
 * - `401` — missing/invalid/expired API key (from `requireApiKey`)
 * - `403` — API key disabled or tenant inactive (from `requireApiKey`)
 * - `400` — request body fails schema validation (from `zValidator`)
 * - `5xx` — Supabase error while inserting the event (via `supabaseError`)
 */
eventRoutes.post('/events', requireApiKey, zValidator('json', trackEventSchema), async (c) => {
  const body = c.req.valid('json')
  const apiKey = c.get('apiKey')

  const { error } = await supabase
    .from('usage_events')
    .insert({
      tenant_id: apiKey.tenant_id,
      metric: body.metric,
      value: body.value ?? 1,
      properties: body.properties ?? {},
    })

  if (error) {
    logger.error({ error: error.message, metric: body.metric, tenantId: apiKey.tenant_id }, '[Events] Failed to record usage event')
    return supabaseError(c, error)
  }

  return c.json({ success: true }, 202)
})

/**
 * GET /events/summary
 *
 * Return an aggregated usage summary for the current tenant, totaling
 * `usage_events` values per metric over a time window.
 *
 * Auth: requires a valid API key (`requireApiKey`). Scoped to the
 * tenant tied to the API key.
 *
 * Input (query params):
 * - `metric` (string, optional) — filter to a single metric name
 * - `since` (ISO date string, optional, default: now minus
 *   `DEFAULT_SUMMARY_WINDOW_DAYS` = 30 days) — start of the window
 *
 * Response: `200 OK`
 * ```
 * {
 *   "summary": [{ "metric": string, "total": number }, ...], // sorted desc by total
 *   "since": string // ISO date used for the window start
 * }
 * ```
 *
 * Errors:
 * - `401` — missing/invalid/expired API key (from `requireApiKey`)
 * - `403` — API key disabled or tenant inactive (from `requireApiKey`)
 * - `5xx` — Supabase error while querying events (via `supabaseError`)
 */
eventRoutes.get('/events/summary', requireApiKey, async (c) => {
  const apiKey = c.get('apiKey')

  const metric = c.req.query('metric')
  const since = c.req.query('since') ?? new Date(Date.now() - DEFAULT_SUMMARY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  let query = supabase
    .from('usage_events')
    .select('metric, value')
    .eq('tenant_id', apiKey.tenant_id)
    .gte('created_at', since)

  if (metric) {
    query = query.eq('metric', metric)
  }

  const { data: events, error } = await query

  if (error) return supabaseError(c, error)

  type MetricEntry = { metric: string; total: number }
  const metricsMap = new Map<string, number>()

  for (const event of (events ?? []) as unknown as Array<{ metric: string; value: number }>) {
    const value = typeof event.value === 'number' ? event.value : 1
    metricsMap.set(event.metric, (metricsMap.get(event.metric) ?? 0) + value)
  }

  const summary: MetricEntry[] = Array.from(metricsMap.entries())
    .map(([metric, total]) => ({ metric, total }))
    .sort((a, b) => b.total - a.total)

  return c.json({ summary, since })
})
