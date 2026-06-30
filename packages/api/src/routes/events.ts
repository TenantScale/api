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
 * Receive a usage event from the SDK.
 * Stores raw events in the usage_events table for later aggregation.
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
 * Get usage summary for the current tenant.
 * Aggregates usage_events within the given time window.
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
