// ──────────────────────────────────────────────────────
// Supabase type helpers — typed wrappers for common
// Supabase query result shapes used across the API.
// ──────────────────────────────────────────────────────

/** A tenant row from the `tenants` table */
export interface TenantRow {
  id: string
  name: string
  slug: string
  plan_id: string
  is_active: boolean
  features: Record<string, unknown>
  config: Record<string, unknown>
  settings: Record<string, unknown>
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at?: string | null
}

/** A tenant_users membership row from the `tenant_users` table */
export interface TenantUserRow {
  id: string
  tenant_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
  joined_at: string
  invited_by: string | null
}

/** A tenant_user joined with the tenant relationship */
export interface TenantUserWithTenant extends TenantUserRow {
  tenant: TenantRow | null
}

/** An API key row from the `api_keys` table */
export interface ApiKeyRow {
  id: string
  tenant_id: string
  label: string
  key_prefix: string
  key_hash: string
  scopes: string[]
  is_active: boolean
  expires_at: string | null
  last_used_at: string | null
  created_at: string
  created_by: string
}

/** A plan row from the `plans` table */
export interface PlanRow {
  id: string
  name: string
  description: string | null
  price_monthly: number | null
  features: Record<string, unknown>
  max_users: number | null
  max_tenants: number | null
  sort_order: number | null
  is_active: boolean
  created_at: string
  updated_at: string | null
}

/** An audit event row from the `audit_events` table */
export interface AuditEventRow {
  id: string
  tenant_id: string
  actor_id: string | null
  actor_type: 'user' | 'system' | 'admin_api' | 'admin_impersonation'
  action: string
  resource: string
  details: Record<string, unknown>
  ip: string | null
  user_agent: string | null
  created_at: string
}

/** A Supabase query response shape */
export interface QueryResult<T> {
  data: T | null
  error: { message: string; code?: string; details?: string; hint?: string } | null
  count?: number | null
}

/** A paginated query result */
export interface PaginatedResult<T> {
  data: T[] | null
  error: { message: string; code?: string } | null
  count: number | null
}
