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
import { supabase } from '../db/supabase.js'
import { logger } from '../lib/logger.js'

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

/**
 * Auth middleware for the alert-check route. Accepts either credential:
 *
 *  - `Authorization: Bearer *** API key>` — the key is SHA-256 hashed and
 *    looked up in `api_keys`; the request passes only if the matching
 *    record's `scopes` includes `admin`.
 *  - `X-Cron-Secret: <secret>` — passes if it exactly matches the
 *    `CRON_SECRET` environment variable.
 *
 * Responds `401 { error: 'Unauthorized' }` if neither credential is
 * present or valid.
 */
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

/**
 * Evaluates the `HighErrorRate` alert: fraction of `audit_events` in the
 * last 5 minutes whose `action` matches `%error%`/`%fail%`. Fires when
 * that rate exceeds 5%. On query failure, returns `status: 'ok'` with the
 * error message folded into `message` rather than throwing.
 */
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

/**
 * Evaluates the `WebhookDegraded` alert: fraction of webhook deliveries
 * in the last 15 minutes whose `status` is `failed`. Fires when the
 * failure rate exceeds 10% (i.e., the success rate drops below 90% SLO).
 * On query failure, returns `status: 'ok'` with the error message in
 * `message` rather than throwing.
 */
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

/**
 * Evaluates the `AuthFailureRate` alert: ratio of successful
 * (`api_key.authenticated`) to total (`api_key.authenticated` +
 * `api_key.rejected`) auth attempts in `audit_events` over the last 5
 * minutes. Fires when the success rate drops below 50%, which may
 * indicate a credential-stuffing or brute-force attempt. On query
 * failure, returns `status: 'ok'` with the error message folded into
 * `message` rather than throwing.
 */
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

/**
 * POST /admin/cron/check-alerts
 *
 * Evaluates all configured alert conditions (`HighErrorRate`,
 * `TenantDrop`, `WebhookDegraded`, `AuthFailureRate`) and returns their
 * current state. Intended to be invoked by an external cron scheduler on
 * a fixed interval (recommended: every 5 minutes); the caller is expected
 * to forward `firing` alerts to a notification channel (Slack, email,
 * PagerDuty, etc).
 *
 * Alerts are evaluated concurrently via `Promise.allSettled` — each
 * evaluator also catches its own errors internally, so a failure in one
 * alert's underlying query does not block or fail the others.
 *
 * @auth Requires either:
 *   - `Authorization: Bearer *** API key>`, or
 *   - `X-Cron-Secret: <CRON_SECRET>` header matching the server's
 *     configured cron secret.
 *   See `requireAlertAuth`.
 *
 * @body None.
 *
 * @returns {200} JSON body:
 *   ```
 *   {
 *     success: true,
 *     timestamp: string,      // ISO timestamp of when the check ran
 *     duration_ms: number,    // wall-clock time for the whole check
 *     firing: AlertResult[],  // only alerts currently in 'firing' status
 *     all: AlertResult[],     // every evaluated alert, firing or not
 *     summary: { total: number, firing: number, ok: number }
 *   }
 *   ```
 *   Where `AlertResult` is:
 *   ```
 *   {
 *     alert: string,
 *     severity: 'critical' | 'warning',
 *     status: 'firing' | 'ok',
 *     message: string,
 *     value?: number,
 *     threshold?: number,
 *     lastChecked: string // ISO timestamp
 *   }
 *   ```
 *
 * @errors
 *   - 401 `{ error: 'Unauthorized' }` — missing/invalid Bearer key and
 *     missing/invalid `X-Cron-Secret`.
 *   - 500 `{ error: 'Alert check failed' }` — unexpected exception outside
 *     the individual alert evaluators (e.g. `Promise.allSettled` setup
 *     itself throwing). Individual evaluator failures do NOT produce this
 *     error; they instead surface as an `ok`-status alert with the error
 *     message embedded.
 */
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
