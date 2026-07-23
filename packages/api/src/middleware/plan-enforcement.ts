// ──────────────────────────────────────────────────────
// Plan Enforcement Middleware
// Server-side checks for plan limits and feature gates.
//
// These run AFTER auth so we have a resolved tenant ID.
// They are the server-side authority — the SDK's helpers
// are client-side convenience, not security boundaries.
//
// Usage:
//   app.post('/v1/tenants', requireApiKey, requirePlanLimit('max_tenants', countTenants))
//   app.post('/v1/tenants', requireApiKey, requirePlanFeature('webhooks'))
// ──────────────────────────────────────────────────────

import type { Context, Next } from 'hono'
import { getPlanLimit, hasPlanFeature } from '../lib/plan-store.js'
import type { ApiKeyContext } from '../env.js'

// ── Types ──

export interface PlanLimitErrorResponse {
  error: string
  code: string
  limit: number | null
  current: number
}

export interface PlanFeatureErrorResponse {
  error: string
  code: string
  feature: string
}

// ── Helpers ──

/**
 * Extract tenant_id from the current request context.
 * Works with both API-key auth (requireApiKey) and portal session auth.
 */
function getTenantId(c: Context): string | undefined {
  // Check API key context first
  const apiKey: ApiKeyContext | undefined = c.get('apiKey')
  if (apiKey?.tenant_id) return apiKey.tenant_id

  // Check portal session (stored as 'portalSession' by session-auth middleware)
  const session = c.get('portalSession') as { tenant_id?: string } | undefined
  if (session?.tenant_id) return session.tenant_id

  return undefined
}

// ── Middleware Factories ──

/**
 * Middleware that checks a numeric plan limit.
 * Rejects with 403 if the current count >= the plan's limit.
 * Passes through if the limit is null (unlimited).
 *
 * @param limitField - Column name on the plans table (e.g. 'max_tenants', 'max_users')
 *   or feature key in features JSONB (e.g. 'api_calls_per_day', 'team_members')
 * @param getCurrentCount - Async function that returns the current usage count.
 *   Receives the Hono context so it can read params/query/body.
 *
 * Example:
 *   app.post('/admin/tenants', requireApiKey, requireScope('admin'),
 *     requirePlanLimit('max_tenants', async (c) => {
 *       // count logic here
 *     }))
 */
export function requirePlanLimit(
  limitField: string,
  getCurrentCount: (c: Context) => Promise<number> | number,
) {
  return async (c: Context, next: Next) => {
    const tenantId = getTenantId(c)
    if (!tenantId) {
      return c.json({ error: 'Authentication required for plan enforcement' }, 401)
    }

    const limit = await getPlanLimit(tenantId, limitField)

    // null = unlimited, pass through
    if (limit === null) {
      return next()
    }

    const current = await getCurrentCount(c)

    if (current >= limit) {
      const response: PlanLimitErrorResponse = {
        error: `Plan limit reached: ${limitField}. Upgrade your plan to increase this limit.`,
        code: 'PLAN_LIMIT_REACHED',
        limit,
        current,
      }
      return c.json(response, 403)
    }

    await next()
  }
}

/**
 * Middleware that checks a boolean plan feature flag.
 * Rejects with 403 if the feature is disabled on the tenant's plan.
 * Passes through if the feature is truthy or the key doesn't exist in features
 * (missing = allowed — avoids blocking on unlisted features).
 *
 * IMPORTANT: Feature keys in the plans.features JSONB that should be denied
 * MUST be explicitly set to `false` in the DB. A missing key = allowed.
 *
 * @param feature - Key in the plans.features JSONB column
 *
 * Example:
 *   app.post('/v1/webhooks', requireApiKey, requirePlanFeature('webhooks'))
 */
export function requirePlanFeature(feature: string) {
  return async (c: Context, next: Next) => {
    const tenantId = getTenantId(c)
    if (!tenantId) {
      return c.json({ error: 'Authentication required for plan enforcement' }, 401)
    }

    const enabled = await hasPlanFeature(tenantId, feature)

    if (!enabled) {
      const response: PlanFeatureErrorResponse = {
        error: `This feature requires an upgraded plan: ${feature.replace(/_/g, ' ')}.`,
        code: 'PLAN_LIMIT_REACHED',
        feature,
      }
      return c.json(response, 403)
    }

    await next()
  }
}

/**
 * Middleware that validates a plan_id exists in the DB.
 * Returns 400 with a helpful message if the plan doesn't exist.
 *
 * Example:
 *   app.post('/v1/tenants', validatePlanIdParam(), handler)
 */
export function validatePlanId(paramName = 'plan_id') {
  return async (c: Context, next: Next) => {
    const { supabase } = await import('../db/supabase')

    // Get from body (JSON) or query param
    let planId: string | undefined

    if (c.req.method === 'GET' || c.req.method === 'DELETE') {
      planId = c.req.query(paramName)
    } else {
      try {
        const body = await c.req.json()
        planId = body[paramName]
      } catch {
        // Not JSON body — skip validation
        return next()
      }
    }

    if (!planId) {
      return next() // Missing plan_id is handled by schema default
    }

    const { data: plan } = await supabase
      .from('plans')
      .select('id')
      .eq('id', planId)
      .single()

    if (!plan) {
      return c.json({
        error: `Invalid plan ID: "${planId}". Available plans: free, hobby, pro, scale, enterprise.`,
        code: 'INVALID_PLAN',
      }, 400)
    }

    await next()
  }
}
