// ──────────────────────────────────────────────────────
// Plan store — delegates to @tenantscale/sdk
// ──────────────────────────────────────────────────────

import { getSdk } from './sdk'
import type { PlanInfo } from '@tenantscale/sdk'

export type { PlanInfo }

/**
 * Resolve plan for a tenant. Cached for 5 minutes.
 * Returns null on error (fail closed — denial).
 */
export async function getPlanForTenant(tenantId: string): Promise<PlanInfo | null> {
  return getSdk().plans.getPlanForTenant(tenantId)
}

/**
 * Get a plan limit for a given tenant and feature.
 * Returns null if unlimited. Returns 0 if plan can't be resolved (fail-closed).
 */
export async function getPlanLimit(tenantId: string, feature: string): Promise<number | null> {
  return getSdk().plans.getPlanLimit(tenantId, feature)
}

/**
 * Check if a tenant's plan has a specific boolean feature enabled.
 */
export async function hasPlanFeature(tenantId: string, feature: string): Promise<boolean> {
  return getSdk().plans.hasPlanFeature(tenantId, feature)
}

/**
 * Invalidate the plan cache for a specific tenant.
 */
export function invalidatePlanCache(tenantId: string): void {
  getSdk().plans.invalidate(tenantId)
}
