// ──────────────────────────────────────────────────────
// Usage Billing — metered usage aggregation and Stripe sync
// ──────────────────────────────────────────────────────
// Handles:
//   - Current billing period usage totals
//   - Seat counts and overage calculations
//   - Stripe usage record submission
//   - Billing period lifecycle management
// ──────────────────────────────────────────────────────

import { supabase } from '../db/supabase.js'
import { logger } from './logger.js'

// ── Types ──

export interface UsageTotals {
  /** Total API calls in the current billing period */
  api_calls: number
  /** Total active users (seats) */
  active_users: number
  /** Plan limits */
  plan_limits: {
    api_calls_per_day: number | null
    max_users: number | null
  }
  /** Overage rates (null if overages not supported on this plan) */
  overage_rates: {
    per_call: number | null
    per_user: number | null
  }
  /** Billing period info */
  billing_period: {
    starts_at: string | null
    ends_at: string | null
    days_remaining: number | null
  }
}

export interface BillingPeriodInfo {
  id: string
  starts_at: string
  ends_at: string | null
  status: string
}

// ── Billing period management ──

/**
 * Get or create the active billing period for a tenant.
 * If no active period exists, creates one starting from the current time
 * and ending 30 days later.
 */
export async function getOrCreateBillingPeriod(tenantId: string): Promise<BillingPeriodInfo | null> {
  // Look for an active billing period
  const { data: active } = await supabase
    .from('billing_periods')
    .select('id, starts_at, ends_at, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (active) return active as unknown as BillingPeriodInfo

  // No active period — create one (30-day default billing cycle)
  const now = new Date()
  const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const { data: created, error } = await supabase
    .from('billing_periods')
    .insert({
      tenant_id: tenantId,
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      status: 'active',
    })
    .select()
    .single()

  if (error || !created) {
    logger.error({ error, tenantId }, '[UsageBilling] Failed to create billing period')
    return null
  }

  return created as unknown as BillingPeriodInfo
}

/**
 * Get the current usage totals for a tenant's active billing period.
 */
export async function getUsageTotals(tenantId: string): Promise<UsageTotals> {
  const billingPeriod = await getOrCreateBillingPeriod(tenantId)

  // Get total API calls in the current billing period
  let apiCalls = 0
  if (billingPeriod?.starts_at) {
    const { data: usageData } = await supabase
      .from('usage_events')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('metric', 'api_call')
      .gte('created_at', billingPeriod.starts_at)

    if (usageData) {
      apiCalls = (usageData as unknown as Array<{ value: number }>)
        .reduce((sum, e) => sum + (e.value ?? 0), 0)
    }
  }

  // Count active users (seats)
  const { count: userCount } = await supabase
    .from('tenant_users')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)

  const activeUsers = userCount ?? 0

  // Get plan limits and overage rates
  const { data: tenant } = await supabase
    .from('tenants')
    .select('plan_id')
    .eq('id', tenantId)
    .single()

  let apiCallsPerDay: number | null = null
  let maxUsers: number | null = null
  let overagePerCall: number | null = null
  let overagePerUser: number | null = null

  if (tenant) {
    const { data: plan } = await supabase
      .from('plans')
      .select('api_calls_per_day, max_users, overage_rate_per_call, overage_rate_per_user')
      .eq('id', tenant.plan_id)
      .single()

    if (plan) {
      apiCallsPerDay = (plan as unknown as { api_calls_per_day: number | null }).api_calls_per_day ?? null
      maxUsers = (plan as unknown as { max_users: number | null }).max_users ?? null
      overagePerCall = (plan as unknown as { overage_rate_per_call: number | null }).overage_rate_per_call ?? null
      overagePerUser = (plan as unknown as { overage_rate_per_user: number | null }).overage_rate_per_user ?? null
    }
  }

  // Calculate days remaining in billing period
  let daysRemaining: number | null = null
  if (billingPeriod?.ends_at) {
    daysRemaining = Math.max(
      0,
      Math.ceil(
        (new Date(billingPeriod.ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
      ),
    )
  }

  return {
    api_calls: apiCalls,
    active_users: activeUsers,
    plan_limits: {
      api_calls_per_day: apiCallsPerDay,
      max_users: maxUsers,
    },
    overage_rates: {
      per_call: overagePerCall,
      per_user: overagePerUser,
    },
    billing_period: {
      starts_at: billingPeriod?.starts_at ?? null,
      ends_at: billingPeriod?.ends_at ?? null,
      days_remaining: daysRemaining,
    },
  }
}

/**
 * Get projected overage cost for the current billing period.
 */
export function getProjectedOverage(
  totals: UsageTotals,
): { api_calls_overage: number; seat_overage: number; total: number } {
  const dailyApiLimit = totals.plan_limits.api_calls_per_day
  // Approximate monthly API limit = daily * 30
  const monthlyApiLimit = dailyApiLimit ? dailyApiLimit * 30 : null
  const seatLimit = totals.plan_limits.max_users

  let apiCallsOverage = 0
  if (monthlyApiLimit && totals.overage_rates.per_call && totals.api_calls > monthlyApiLimit) {
    apiCallsOverage = (totals.api_calls - monthlyApiLimit) * totals.overage_rates.per_call
  }

  let seatOverage = 0
  if (seatLimit && totals.overage_rates.per_user && totals.active_users > seatLimit) {
    seatOverage = (totals.active_users - seatLimit) * totals.overage_rates.per_user
  }

  return {
    api_calls_overage: Math.round(apiCallsOverage * 100) / 100,
    seat_overage: Math.round(seatOverage * 100) / 100,
    total: Math.round((apiCallsOverage + seatOverage) * 100) / 100,
  }
}

// ── Stripe sync ──

/**
 * Aggregate usage events for a tenant in a date range and submit
 * as a Stripe usage record.
 *
 * @param tenantId - Tenant UUID
 * @param metric - Usage metric to aggregate (e.g. 'api_call')
 * @param stripePriceId - Stripe metered price ID
 * @param subscriptionItemId - Stripe subscription item ID
 * @returns true if sync was successful
 */
export async function syncUsageToStripe(
  tenantId: string,
  metric: string,
  stripePriceId: string,
  subscriptionItemId: string,
): Promise<boolean> {
  // Lazy import Stripe to avoid crashing if not configured
  let stripeClient: any
  try {
    const { stripe } = await import('./stripe.js')
    stripeClient = stripe
  } catch {
    logger.warn({ tenantId }, '[UsageBilling] Stripe not configured, skipping usage sync')
    return false
  }

  const billingPeriod = await getOrCreateBillingPeriod(tenantId)
  if (!billingPeriod?.starts_at) return false

  // Aggregate usage for the metric since period start
  const { data: events } = await supabase
    .from('usage_events')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('metric', metric)
    .gte('created_at', billingPeriod.starts_at)

  const totalUsage = (events ?? []).reduce(
    (sum: number, e: unknown) => sum + ((e as { value: number }).value ?? 0),
    0,
  )

  if (totalUsage <= 0) return true // Nothing to report

  try {
    // Submit usage record to Stripe
    await stripeClient.subscriptionItems.createUsageRecord(
      subscriptionItemId,
      {
        quantity: Math.floor(totalUsage),
        timestamp: Math.floor(Date.now() / 1000),
        action: 'set',
      },
    )

    logger.info({
      tenantId,
      metric,
      usage: totalUsage,
      subscriptionItemId,
    }, '[UsageBilling] Usage synced to Stripe')

    // Mark billing period as synced
    await supabase
      .from('billing_periods')
      .update({
        stripe_sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
      })
      .eq('id', billingPeriod.id)

    return true
  } catch (err) {
    logger.error({ err, tenantId, metric }, '[UsageBilling] Failed to sync usage to Stripe')

    await supabase
      .from('billing_periods')
      .update({
        stripe_sync_status: 'failed',
        stripe_sync_error: err instanceof Error ? err.message : 'Unknown error',
      })
      .eq('id', billingPeriod.id)

    return false
  }
}

/**
 * Sync the current active user count as a seat usage record to Stripe.
 */
export async function syncSeatsToStripe(
  tenantId: string,
  stripeSeatPriceId: string,
  subscriptionItemId: string,
): Promise<boolean> {
  let stripeClient: any
  try {
    const { stripe } = await import('./stripe.js')
    stripeClient = stripe
  } catch {
    logger.warn({ tenantId }, '[UsageBilling] Stripe not configured, skipping seat sync')
    return false
  }

  const { count: userCount } = await supabase
    .from('tenant_users')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)

  const activeUsers = userCount ?? 0

  try {
    await stripeClient.subscriptionItems.createUsageRecord(
      subscriptionItemId,
      {
        quantity: activeUsers,
        timestamp: Math.floor(Date.now() / 1000),
        action: 'set',
      },
    )

    logger.info({
      tenantId,
      seats: activeUsers,
      subscriptionItemId,
    }, '[UsageBilling] Seats synced to Stripe')

    return true
  } catch (err) {
    logger.error({ err, tenantId, seats: activeUsers }, '[UsageBilling] Failed to sync seats to Stripe')
    return false
  }
}
