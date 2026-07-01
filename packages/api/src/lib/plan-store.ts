// ──────────────────────────────────────────────────────
// Plan store — cached plan resolution via Supabase
// ──────────────────────────────────────────────────────

import { supabase } from '../db/supabase'

export interface PlanInfo {
  id: string
  name: string
  price_monthly: number
  max_users: number | null
  max_tenants: number | null
  max_api_keys: number | null
  api_calls_per_day: number | null
  audit_retention_days: number | null
  features: Record<string, boolean | number | string | null>
  _raw_features: Record<string, unknown>
}

// Simple in-memory cache with 5-minute TTL
const planCache = new Map<string, { plan: PlanInfo; fetchedAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

async function fetchPlanForTenant(tenantId: string): Promise<PlanInfo | null> {
  const { data: tenant } = await supabase
    .from('tenants')
    .select('plan_id')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant?.plan_id) return null

  const { data: plan } = await supabase
    .from('plans')
    .select('*')
    .eq('id', tenant.plan_id)
    .single()

  if (!plan) return null

  const features = (plan.features as Record<string, unknown>) ?? {}
  const _raw_features: Record<string, unknown> = { ...features }

  // Extract known boolean/number features
  const extractedFeatures: Record<string, boolean | number | string | null> = {}
  for (const [key, value] of Object.entries(features)) {
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' || value === null) {
      extractedFeatures[key] = value
    }
  }

  return {
    id: plan.id,
    name: plan.name,
    price_monthly: plan.price_monthly,
    max_users: plan.max_users,
    max_tenants: plan.max_tenants,
    max_api_keys: plan.max_api_keys,
    api_calls_per_day: plan.api_calls_per_day,
    audit_retention_days: plan.audit_retention_days,
    features: extractedFeatures,
    _raw_features,
  }
}

/**
 * Resolve plan for a tenant. Cached for 5 minutes.
 * Returns null on error (fail closed — denial).
 */
export async function getPlanForTenant(tenantId: string): Promise<PlanInfo | null> {
  const cached = planCache.get(tenantId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.plan
  }

  const plan = await fetchPlanForTenant(tenantId)
  if (plan) {
    planCache.set(tenantId, { plan, fetchedAt: Date.now() })
  }
  return plan
}

/**
 * Get a plan limit for a given tenant and feature.
 * Returns null if unlimited. Returns 0 if plan can't be resolved (fail-closed).
 */
export async function getPlanLimit(tenantId: string, feature: string): Promise<number | null> {
  const plan = await getPlanForTenant(tenantId)
  if (!plan) return 0

  // Check direct columns first
  const directFields: Record<string, keyof PlanInfo> = {
    max_users: 'max_users',
    max_tenants: 'max_tenants',
    max_api_keys: 'max_api_keys',
    api_calls_per_day: 'api_calls_per_day',
    audit_retention_days: 'audit_retention_days',
  }

  if (feature in directFields) {
    return plan[directFields[feature]] as number | null
  }

  // Fall back to features JSONB
  const value = plan.features[feature]
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  return null
}

/**
 * Check if a tenant's plan has a specific boolean feature enabled.
 */
export async function hasPlanFeature(tenantId: string, feature: string): Promise<boolean> {
  const plan = await getPlanForTenant(tenantId)
  if (!plan) return false
  return plan.features[feature] === true
}

/**
 * Invalidate the plan cache for a specific tenant.
 */
export function invalidatePlanCache(tenantId: string): void {
  planCache.delete(tenantId)
}
