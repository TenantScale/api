// ──────────────────────────────────────────────────────
// Rate Limiting middleware — two layers
//
// Layer 1: Global DDoS guard (IP-based, generous window)
//   - Applied to all routes
//   - Prevents IP-level abuse
//   - Keys by client IP, not tenant
//
// Layer 2: Plan-aware daily API call limiter
//   - Applied to v1/* routes
//   - Keys by tenant_id, enforces plan's api_calls_per_day
//   - Resets daily at UTC midnight
//   - Extracts API key itself (doesn't depend on auth having run)
// ──────────────────────────────────────────────────────

import type { Context, Next } from 'hono'
import { createHash } from 'node:crypto'
import { supabase } from '../db/supabase.js'
import { logger } from '../lib/logger.js'

// ── Interval registry ──
// Tracks all created cleanup intervals so they can be cleared on demand
// (e.g. during testing or module hot-reload).
const _cleanupIntervals: ReturnType<typeof setInterval>[] = []

function _registerInterval(interval: ReturnType<typeof setInterval>): void {
  _cleanupIntervals.push(interval)
}

/**
 * Clear all tracked cleanup intervals and reset shared stores.
 * Useful in tests and to prevent interval pile-up on module hot-reload.
 */
export function resetAllIntervals(): void {
  for (const interval of _cleanupIntervals) {
    clearInterval(interval)
  }
  _cleanupIntervals.length = 0
  keyCache.clear()
  ipCreationStore.clear()
}

// ── Caches ──

/** Cache for API key → tenant_id + plan lookup (5 min TTL) */
const KEY_CACHE_TTL_MS = 5 * 60 * 1000
interface KeyCacheEntry {
  tenant_id: string
  plan_id: string
  daily_limit?: number | null
  fetchedAt: number
}
const keyCache = new Map<string, KeyCacheEntry>()

/** Daily counters are stored in the `rate_limits` table (survives restarts, works across instances) */

function getTodayKey(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
}

/** Seconds remaining until the daily counter resets (next UTC midnight). */
function getSecondsUntilUtcMidnight(): number {
  const now = new Date()
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
  )
  return Math.max(0, Math.ceil((nextMidnight - now.getTime()) / 1000))
}

/** Standardised rate-limit error shape used by both layers. */
interface RateLimitErrorBody {
  error: string
  code: string
  retry_after?: number
}

/** Build a 429 response with a Retry-After header when retry_after is provided. */
function rateLimitError(c: Context, body: RateLimitErrorBody, status: 429 = 429) {
  if (body.retry_after !== undefined) {
    c.header('Retry-After', String(body.retry_after))
  }
  return c.json(body, status)
}

// ── Layer 1: IP-based DDoS guard ──

interface DdosGuardOptions {
  maxRequests: number
  windowMs: number
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

/**
 * Lightweight IP-based DDoS protection.
 * Applied globally to all routes.
 * Uses a short window (e.g. 60s) with a high limit.
 */
export function createDdosGuard(options: DdosGuardOptions) {
  const { maxRequests, windowMs } = options
  const store = new Map<string, RateLimitEntry>()

  // Periodic cleanup every 60 seconds
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of Array.from(store.entries())) {
      if (entry.resetAt <= now) {
        store.delete(key)
      }
    }
  }, 60_000)
  if (cleanupInterval.unref) cleanupInterval.unref()
  _registerInterval(cleanupInterval)

  const middlewareFn = async (c: Context, next: Next) => {
    const key = c.req.header('x-forwarded-for')
      ?? c.req.header('x-real-ip')
      ?? 'unknown'

    const now = Date.now()
    let entry = store.get(key)

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      store.set(key, entry)
    }

    entry.count++

    c.header('X-RateLimit-Limit', maxRequests.toString())
    c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)))
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      return rateLimitError(c, {
        error: 'Too many requests',
        code: 'RATE_LIMITED',
        retry_after: retryAfter,
      })
    }

    await next()
  }

  Object.defineProperty(middlewareFn, 'cleanup', {
    value: () => { clearInterval(cleanupInterval); store.clear() },
    writable: false,
  })

  return middlewareFn
}

// ── Layer 2: Plan-aware daily API call limiter ──

/**
 * Plan-aware daily API call limiter.
 *
 * Designed to run AFTER auth middleware OR as a self-contained
 * middleware on v1 routes. It extracts the Bearer token itself
 * and resolves the tenant/plan to enforce api_calls_per_day.
 *
 * Public routes (no auth token) are skipped.
 *
 * Counters reset daily at UTC midnight.
 */
export function createPlanRateLimiter() {
  // Periodic cleanup of stale cache entries (every 5 min)
  // Daily counters are cleaned up by the DB cron (cleanup_rate_limits)
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of Array.from(keyCache.entries())) {
      if (now - entry.fetchedAt > KEY_CACHE_TTL_MS) {
        keyCache.delete(key)
      }
    }
  }, 300_000)
  if (cleanupInterval.unref) cleanupInterval.unref()
  _registerInterval(cleanupInterval)

  const middlewareFn = async (c: Context, next: Next) => {
    // ── 1. Extract tenant_id ──

    let tenantId: string | null = null
    let planId: string | null = null

    // First, check if auth middleware already ran (set apiKey context)
    const existingKey = c.get('apiKey') as { tenant_id: string } | undefined
    if (existingKey?.tenant_id) {
      tenantId = existingKey.tenant_id
      // We need plan_id — check if it's cached
      const cached = keyCache.get(tenantId)
      if (cached) {
        planId = cached.plan_id
      }
    } else {
      // Self-contained mode: extract Bearer token and resolve tenant
      const authHeader = c.req.header('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        // Public route — skip rate limiting
        await next()
        return
      }
      const rawKey = authHeader.slice(7).trim()
      if (!rawKey) {
        await next()
        return
      }

      const keyHash = createHash('sha256').update(rawKey).digest('hex')

      // Check cache
      const cached = keyCache.get(keyHash)
      if (cached && Date.now() - cached.fetchedAt < KEY_CACHE_TTL_MS) {
        tenantId = cached.tenant_id
        planId = cached.plan_id
      } else {
        // Look up the key
        try {
          const { data: keyRecord, error } = await supabase
            .from('api_keys')
            .select('tenant_id, tenant:tenants!inner(plan_id)')
            .eq('key_hash', keyHash)
            .single()

          if (!error && keyRecord) {
            const tenant = keyRecord.tenant as unknown as { plan_id: string }
            tenantId = keyRecord.tenant_id
            planId = tenant.plan_id

            keyCache.set(keyHash, {
              tenant_id: tenantId!,
              plan_id: planId ?? 'free',
              fetchedAt: Date.now(),
            })
          }
        } catch (err) {
          logger.warn({ err }, '[PlanLimiter] Failed to resolve key')
          // Allow the request through on lookup failure
          await next()
          return
        }
      }
    }

    if (!tenantId) {
      await next()
      return
    }

    // ── 2. Resolve plan's daily limit ──

    // Try to get plan_id from cache first
    let dailyLimit: number | null = null
    const cachedPlan = keyCache.get(tenantId)
    const effectivePlanId = planId ?? cachedPlan?.plan_id

    if (effectivePlanId) {
      const planCacheKey = `plan:${effectivePlanId}`
      const planCached = keyCache.get(planCacheKey)
      if (planCached && Date.now() - planCached.fetchedAt < KEY_CACHE_TTL_MS) {
        dailyLimit = planCached.daily_limit ?? null
      }
    }

    if (dailyLimit === null && effectivePlanId) {
      try {
        const { data: plan } = await supabase
          .from('plans')
          .select('api_calls_per_day')
          .eq('id', effectivePlanId)
          .single()

        dailyLimit = plan?.api_calls_per_day ?? null
        if (dailyLimit !== null) {
          keyCache.set(`plan:${effectivePlanId}`, {
            tenant_id: '',
            plan_id: effectivePlanId,
            daily_limit: dailyLimit,
            fetchedAt: Date.now(),
          })
        }
      } catch (err) {
        logger.warn({ err, plan: effectivePlanId }, '[PlanLimiter] Failed to fetch plan limit')
      }
    }

    // null = unlimited (enterprise)
    if (dailyLimit === null || dailyLimit === 0) {
      await next()
      return
    }

    // ── 3. Enforce daily count (persisted in Postgres — survives restarts) ──

    const today = getTodayKey()

    try {
      const { data, error } = await supabase
        .rpc('increment_rate_limit', {
          p_tenant_id: tenantId,
          p_date: today,
        })
        .single()

      if (error) {
        logger.warn({ error: error.message, tenantId }, '[PlanLimiter] Failed to increment rate limit — allowing request')
        await next()
        return
      }

      const currentCount = (data as { current_count: number } | undefined)?.current_count ?? 0

      c.header('X-RateLimit-Limit-Daily', dailyLimit.toString())
      c.header('X-RateLimit-Remaining-Daily', String(Math.max(0, dailyLimit - currentCount)))

      if (currentCount > dailyLimit) {
        const msg = `Daily API call limit reached (${dailyLimit}). Upgrade your plan for more.`
        return rateLimitError(c, {
          error: msg,
          code: 'DAILY_LIMIT_EXCEEDED',
          retry_after: getSecondsUntilUtcMidnight(),
        })
      }
    } catch (err) {
      logger.error({ err, tenantId }, '[PlanLimiter] Rate limit check threw — allowing request')
      // Fail open on DB error — better to let a few requests through than block all traffic
      await next()
      return
    }

    await next()
  }

  Object.defineProperty(middlewareFn, 'cleanup', {
    value: () => { clearInterval(cleanupInterval); keyCache.clear() },
    writable: false,
  })

  return middlewareFn
}

// ── Re-export old name for backward compat ──
export { createDdosGuard as createRateLimiter }

// ── Layer 3: IP-based creation rate limiter ──
// Applied to anonymous tenant creation endpoints.
// Prevents a single IP from creating excessive tenants.
// In-memory store — replace with Upstash Redis for multi-instance deployments.

const MAX_CREATIONS_PER_IP = 5
const CREATION_WINDOW_MS = 3600_000 // 1 hour
const CREATION_CLEANUP_MS = 300_000 // 5 min

interface CreationEntry {
  timestamps: number[]
}

const ipCreationStore = new Map<string, CreationEntry>()

// Periodic cleanup every 5 minutes
const creationCleanupInterval = setInterval(() => {
  const now = Date.now()
  const cutoff = now - CREATION_WINDOW_MS
  for (const [ip, entry] of Array.from(ipCreationStore.entries())) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff)
    if (entry.timestamps.length === 0) {
      ipCreationStore.delete(ip)
    }
  }
}, CREATION_CLEANUP_MS)
if (creationCleanupInterval.unref) creationCleanupInterval.unref()
_registerInterval(creationCleanupInterval)

/**
 * Check if an IP has exceeded the per-IP creation rate limit.
 * Returns true if the limit is exceeded (429), false if allowed.
 *
 * @param ip - The client IP address
 * @returns true if the request should be blocked
 */
export function checkIpCreationLimit(ip: string): boolean {
  const now = Date.now()
  const cutoff = now - CREATION_WINDOW_MS

  let entry = ipCreationStore.get(ip)
  if (!entry) {
    entry = { timestamps: [] }
    ipCreationStore.set(ip, entry)
  }

  // Prune expired timestamps
  entry.timestamps = entry.timestamps.filter(t => t > cutoff)

  if (entry.timestamps.length >= MAX_CREATIONS_PER_IP) {
    return true // Blocked
  }

  entry.timestamps.push(now)
  return false // Allowed
}

/**
 * Reset IP creation state (for testing or manual unblock).
 */
export function resetIpCreationStore(): void {
  ipCreationStore.clear()
}
