// ──────────────────────────────────────────────────────
// Cron Routes — scheduled maintenance endpoints
// ──────────────────────────────────────────────────────
//
// These endpoints are designed to be called by an external
// cron scheduler (GitHub Actions, cron-job.org, etc.).
// They authenticate via an X-Cron-Secret header matching
// the CRON_SECRET env var.
//
// Admin API keys are also accepted for manual triggering
// during development / debugging.
import type { Context, Next } from 'hono'
import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { supabase } from '../db/supabase.js'
import { logger } from '../lib/logger.js'

export const cronRoutes = new Hono()

// ── Middleware: allow either API key or cron secret ──

async function requireCronAuth(c: Context, next: Next) {
  // Check 1: Admin API key (for manual dev triggering)
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    // Validate API key directly (same flow as requireApiKey)
    const rawKey = authHeader.slice(7).trim()
    if (!rawKey) {
      return c.json({ error: 'Empty API key' }, 401)
    }

    const keyHash = createHash('sha256').update(rawKey).digest('hex')

    const { data: keyRecord, error } = await supabase
      .from('api_keys')
      .select('*, tenant:tenants!inner(id, is_active)')
      .eq('key_hash', keyHash)
      .single()

    if (error || !keyRecord) {
      return c.json({ error: 'Invalid API key' }, 401)
    }

    if (!keyRecord.is_active) {
      return c.json({ error: 'API key is deactivated' }, 403)
    }

    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return c.json({ error: 'API key has expired' }, 401)
    }

    if (!keyRecord.scopes?.includes('admin')) {
      return c.json({ error: 'Admin API key required' }, 403)
    }

    await next()
    return
  }

  // Check 2: Cron secret header (for automated scheduling)
  const cronSecret = c.req.header('X-Cron-Secret')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret) {
    logger.warn('[Cron] CRON_SECRET not configured — cron endpoint unavailable')
    return c.json({ error: 'Cron not configured on server' }, 503)
  }

  if (!cronSecret || cronSecret !== expectedSecret) {
    return c.json({ error: 'Invalid cron secret' }, 401)
  }

  await next()
}

/**
 * POST /admin/cron/cleanup-audit
 *
 * Prune expired `audit_events` rows. Calls the DB function
 * `cleanup_expired_audit_events()`, which deletes audit rows older
 * than each plan's configured retention period, and returns a
 * per-plan summary of how many rows were deleted.
 *
 * Intended to be called by an external cron scheduler (recommended:
 * daily at 3am), but can also be triggered manually.
 *
 * Auth: `requireCronAuth` — either an `X-Cron-Secret` header matching
 * the `CRON_SECRET` env var, or a `Bearer` admin API key (scope
 * `admin`).
 *
 * Input: none.
 *
 * Response: `200 OK`
 * ```
 * {
 *   "success": true,
 *   "total_deleted": number,
 *   "per_plan": Array<{ plan_id: string; deleted_rows: number }>,
 *   "duration_ms": number
 * }
 * ```
 *
 * Errors:
 * - `401` — missing/empty/invalid API key, or invalid cron secret
 * - `403` — API key lacks `admin` scope
 * - `503` — `CRON_SECRET` not configured on the server
 * - `500` — the `cleanup_expired_audit_events` RPC failed, or an
 *   unexpected exception was thrown during cleanup
 */
cronRoutes.post('/admin/cron/cleanup-audit', requireCronAuth, async (c) => {
  const startTime = Date.now()

  try {
    const { data, error } = await supabase.rpc('cleanup_expired_audit_events')

    if (error) {
      logger.error({ error }, '[Cron] cleanup_expired_audit_events RPC failed')
      return c.json({
        error: 'Audit cleanup failed',
        details: error.message,
      }, 500)
    }

    const durationMs = Date.now() - startTime
    const totalDeleted = (data as Array<{ plan_id: string; deleted_rows: number }> | null)
      ?.reduce((sum, row) => sum + Number(row.deleted_rows), 0) ?? 0

    logger.info({
      totalDeleted,
      durationMs,
      perPlan: data,
    }, '[Cron] Audit cleanup completed')

    return c.json({
      success: true,
      total_deleted: totalDeleted,
      per_plan: data ?? [],
      duration_ms: durationMs,
    })
  } catch (err) {
    logger.error(err, '[Cron] Audit cleanup threw exception')
    return c.json({
      error: 'Audit cleanup threw unexpected error',
    }, 500)
  }
})

/**
 * GET /admin/cron/status
 *
 * Dry-run preview of the audit cleanup job. For each plan with an
 * `audit_log_retention_days` feature configured, counts how many
 * `audit_events` rows are currently past their retention cutoff,
 * WITHOUT deleting anything. Useful for monitoring/dashboards.
 *
 * Auth: `requireCronAuth` — either an `X-Cron-Secret` header matching
 * the `CRON_SECRET` env var, or a `Bearer` admin API key (scope
 * `admin`).
 *
 * Input: none.
 *
 * Response: `200 OK`
 * ```
 * {
 *   "dry_run": true,
 *   "total_expired": number,
 *   "per_plan": Array<{
 *     plan_id: string;
 *     plan_name: string;
 *     retention_days: number;
 *     expired_count: number;
 *   }>
 * }
 * ```
 *
 * Errors:
 * - `401` — missing/empty/invalid API key, or invalid cron secret
 * - `403` — API key lacks `admin` scope
 * - `503` — `CRON_SECRET` not configured on the server
 * - `500` — failed to fetch plans, or an unexpected exception was
 *   thrown while computing the status
 */
cronRoutes.get('/admin/cron/status', requireCronAuth, async (c) => {
  try {
    const { data: plans, error: plansError } = await supabase
      .from('plans')
      .select('id, name, features')
      .not('features->>audit_log_retention_days', 'is', null)

    if (plansError) {
      return c.json({ error: 'Failed to fetch plans', details: plansError.message }, 500)
    }

    const summary: Array<{
      plan_id: string
      plan_name: string
      retention_days: number
      expired_count: number
    }> = []

    for (const plan of plans ?? []) {
      const retentionDays = (plan.features as Record<string, unknown>)?.audit_log_retention_days as number
      if (!retentionDays || retentionDays <= 0) continue

      const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()

      const { count, error: countError } = await supabase
        .from('audit_events')
        .select('id', { count: 'exact', head: true })
        .in('tenant_id', supabase.from('tenants').select('id').eq('plan_id', plan.id) as any)

      if (countError) {
        logger.warn({ planId: plan.id, error: countError }, '[Cron] Failed to count expired events')
        continue
      }

      // Actually count expired rows for this plan
      const { data: tenantIds } = await supabase
        .from('tenants')
        .select('id')
        .eq('plan_id', plan.id)

      if (!tenantIds?.length) continue

      const tenantIdList = tenantIds.map(t => t.id)

      // Chunk the tenant IDs for the IN query
      const chunkSize = 100
      let totalExpired = 0

      for (let i = 0; i < tenantIdList.length; i += chunkSize) {
        const chunk = tenantIdList.slice(i, i + chunkSize)
        const { count } = await supabase
          .from('audit_events')
          .select('id', { count: 'exact', head: true })
          .in('tenant_id', chunk)
          .lt('created_at', cutoff)

        totalExpired += count ?? 0
      }

      summary.push({
        plan_id: plan.id,
        plan_name: plan.name,
        retention_days: retentionDays,
        expired_count: totalExpired,
      })
    }

    return c.json({
      dry_run: true,
      total_expired: summary.reduce((s, r) => s + r.expired_count, 0),
      per_plan: summary,
    })
  } catch (err) {
    logger.error(err, '[Cron] Status check threw exception')
    return c.json({ error: 'Status check failed' }, 500)
  }
})
