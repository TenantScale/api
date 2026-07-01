// ──────────────────────────────────────────────────────
// Alert Check Routes — self-contained alert evaluation
// ──────────────────────────────────────────────────────
// For deployments WITHOUT Prometheus, this endpoint
// evaluates the same conditions as the Prometheus alerting
// rules and returns the current alert state as JSON.
//
// Cron-job integration:
//   1. Call GET /admin/cron/check-alerts every 5 minutes
//   2. Wire the response into your notification system
//      (Slack, email, PagerDuty webhook)
//
// Auth: X-Cron-Secret header or admin API key
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { supabase } from '../db/supabase'
import { logger } from '../lib/logger'

export const alertCheckRoutes = new Hono()

// ── Types ──

interface AlertResult {
  alert: string
  severity: 'critical' | 'warning'
  status: 'firing' | 'ok'
  message: string
  value?: number
  threshold?: number
  lastChecked: string
}

// ── Middleware: cron auth (same pattern as admin/cron) ──

async function requireAlertAuth(c: any, next: any) {
  const authHeader = c.req.header('Authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const keyHash = (await import('node:crypto')).createHash('sha256')
      .update(authHeader.slice(7).trim())
      .digest('hex')

    const { data: keyRecord } = await supabase
      .from('api_keys')
      .select('scopes')
      .eq('key_hash', keyHash)
      .maybeSingle()

    if (keyRecord?.scopes?.includes('admin')) {
      await next()
      return
    }
  }

  const cronSecret = c.req.header('X-Cron-Secret')
  const expected = process.env.CRON_SECRET
  if (expected && cronSecret === expected) {
    await next()
    return
  }

  return c.json({ error: 'Unauthorized' }, 401)
}

// ── Alert evaluations ──

async function evalHighErrorRate(): Promise<AlertResult> {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString()
    const { count: total } = await supabase
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', fiveMinAgo)

    const { count: errorCount } = await supabase
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', fiveMinAgo)
      .or('action.ilike.%error%,action.ilike.%fail%')

    const rate = total && total > 0 ? (errorCount ?? 0) / total : 0
    const firing = rate > 0.05
    return {
      alert: 'HighErrorRate',
      severity: 'critical',
      status: firing ? 'firing' : 'ok',
      message: firing
        ? `Error rate is ${(rate * 100).toFixed(1)}% — exceeds 5% threshold`
        : `Error rate is ${(rate * 100).toFixed(1)}% — within threshold`,
      value: rate,
      threshold: 0.05,
      lastChecked: new Date().toISOString(),
    }
  } catch (err) {
    return {
      alert: 'HighErrorRate',
      severity: 'critical',
      status: 'ok',
      message: `Could not evaluate: ${err instanceof Error ? err.message : 'unknown'}`,
      lastChecked: new Date().toISOString(),
    }
  }
}

async function evalActiveTenants(): Promise<AlertResult> {
  try {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 3600000).toISOString()

    const { count: currentCount } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)

    const { count: recentCount } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .gte('created_at', oneHourAgo)

    const firing = currentCount !== null && recentCount !== null &&
      recentCount > 0 && currentCount < recentCount * 0.8

    return {
      alert: 'TenantDrop',
      severity: 'warning',
      status: firing ? 'firing' : 'ok',
      message: firing
        ? `Active tenants dropped from ${recentCount} to ${currentCount} — >20% decrease`
        : `Active tenants: ${currentCount ?? '?'}`,
      value: currentCount ?? undefined,
      threshold: undefined,
      lastChecked: new Date().toISOString(),
    }
  } catch (err) {
    return {
      alert: 'TenantDrop',
      severity: 'warning',
      status: 'ok',
      message: `Could not evaluate: ${err instanceof Error ? err.message : 'unknown'}`,
      lastChecked: new Date().toISOString(),
    }
  }
}

async function evalWebhookFailures(): Promise<AlertResult> {
  try {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60000).toISOString()

    const { count: failedCount } = await supabase
      .from('webhook_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('created_at', fifteenMinAgo)

    const { count: totalCount } = await supabase
      .from('webhook_deliveries')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', fifteenMinAgo)

    const rate = totalCount && totalCount > 0 ? (failedCount ?? 0) / totalCount : 0
    const firing = rate > 0.10

    return {
      alert: 'WebhookDegraded',
      severity: 'warning',
      status: firing ? 'firing' : 'ok',
      message: firing
        ? `Webhook success rate ${((1 - rate) * 100).toFixed(0)}% — below 90% SLO`
        : `Webhook success rate ${((1 - rate) * 100).toFixed(0)}% — within SLO`,
      value: rate,
      threshold: 0.10,
      lastChecked: new Date().toISOString(),
    }
  } catch (err) {
    return {
      alert: 'WebhookDegraded',
      severity: 'warning',
      status: 'ok',
      message: `Could not evaluate: ${err instanceof Error ? err.message : 'unknown'}`,
      lastChecked: new Date().toISOString(),
    }
  }
}

async function evalAuthFailureRate(): Promise<AlertResult> {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString()

    const { count: failCount } = await supabase
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', fiveMinAgo)
      .eq('action', 'api_key.authenticated')

    const { count: totalCount } = await supabase
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', fiveMinAgo)
      .or('action.eq.api_key.authenticated,action.eq.api_key.rejected')

    const rate = totalCount && totalCount > 0 ? (failCount ?? 0) / totalCount : 0
    const firing = rate < 0.5 // more than 50% failures — suspicious

    return {
      alert: 'AuthFailureRate',
      severity: 'warning',
      status: firing ? 'firing' : 'ok',
      message: firing
        ? `Auth success rate is ${(rate * 100).toFixed(0)}% — possible attack`
        : `Auth success rate is ${(rate * 100).toFixed(0)}% — normal`,
      value: rate,
      threshold: 0.5,
      lastChecked: new Date().toISOString(),
    }
  } catch (err) {
    return {
      alert: 'AuthFailureRate',
      severity: 'warning',
      status: 'ok',
      message: `Could not evaluate: ${err instanceof Error ? err.message : 'unknown'}`,
      lastChecked: new Date().toISOString(),
    }
  }
}

// ════════════════════════════════════════════════════════════════
// POST /admin/cron/check-alerts
// ════════════════════════════════════════════════════════════════
// Evaluate all alert conditions and return their current state.
// Designed to be called by an external cron scheduler every 5 min.
//
// All alerts are evaluated in parallel. Each evaluation is
// independent — a single failure won't block other alerts.
// ════════════════════════════════════════════════════════════════

alertCheckRoutes.post('/admin/cron/check-alerts', requireAlertAuth, async (c) => {
  const startTime = Date.now()

  try {
    const results = await Promise.allSettled([
      evalHighErrorRate(),
      evalActiveTenants(),
      evalWebhookFailures(),
      evalAuthFailureRate(),
    ])

    const alerts: AlertResult[] = results
      .filter((r): r is PromiseFulfilledResult<AlertResult> => r.status === 'fulfilled')
      .map(r => r.value)

    const firingAlerts = alerts.filter(a => a.status === 'firing')
    const durationMs = Date.now() - startTime

    logger.info({
      totalAlerts: alerts.length,
      firingCount: firingAlerts.length,
      firingNames: firingAlerts.map(a => a.alert),
      durationMs,
    }, '[Alerts] Check completed')

    return c.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
      firing: firingAlerts,
      all: alerts,
      summary: {
        total: alerts.length,
        firing: firingAlerts.length,
        ok: alerts.length - firingAlerts.length,
      },
    })
  } catch (err) {
    logger.error(err, '[Alerts] Check threw exception')
    return c.json({ error: 'Alert check failed' }, 500)
  }
})
