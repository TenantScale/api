import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Lazy Supabase admin client (service_role key).
 * Initialized on first access so the function doesn't crash during cold start
 * if env vars haven't propagated yet.
 */
let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment'
    )
  }

  _supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: 'public',
    },
    global: {
      fetch: (url: RequestInfo | URL, init?: RequestInit) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }),
    },
  })
  return _supabase
}

/** Get the Supabase client (initializes lazily) */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    const client = getSupabase()
    const value = (client as any)[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})

/**
 * Type helpers for database rows
 */
export type DbTenant = {
  id: string
  name: string
  slug: string
  plan_id: string
  features: Record<string, unknown>
  config: Record<string, unknown>
  settings: Record<string, unknown>
  is_active: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type DbAuditEvent = {
  id: string
  tenant_id: string
  actor_id: string | null
  actor_type: 'user' | 'system' | 'admin_impersonation'
  action: string
  resource: string
  details: Record<string, unknown>
  ip: string | null
  user_agent: string | null
  created_at: string
}

export type DbApiKey = {
  id: string
  tenant_id: string
  label: string
  key_hash: string
  key_prefix: string
  scopes: string[]
  is_active: boolean
  expires_at: string | null
  last_used_at: string | null
  created_by: string | null
  created_at: string
}

export type DbWebhook = {
  id: string
  tenant_id: string
  url: string
  events: string[]
  secret: string
  description: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export type DbWebhookDelivery = {
  id: string
  webhook_id: string
  event_type: string
  url: string
  request_body: string | null
  response_status: number | null
  response_body: string | null
  status: string
  error_message: string | null
  duration_ms: number | null
  created_at: string
}

export type DbPlan = {
  id: string
  name: string
  description: string | null
  price_monthly: number
  features: Record<string, unknown>
  max_users: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type DbTenantUser = {
  id: string
  tenant_id: string
  user_id: string
  role: string
  invited_by: string | null
  joined_at: string
}

export type DbImpersonationSession = {
  id: string
  admin_user_id: string
  target_user_id: string
  target_tenant_id: string
  token_hash: string
  expires_at: string
  revoked_at: string | null
  created_at: string
}

export type DbStripeCustomer = {
  id: string
  tenant_id: string
  stripe_customer_id: string
  created_at: string
}

export type DbSubscription = {
  id: string
  tenant_id: string
  stripe_subscription_id: string
  stripe_customer_id: string
  stripe_price_id: string
  status: 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'trialing' | 'paused'
  plan_id: string
  billing_interval: 'month' | 'year'
  current_period_start: string | null
  current_period_end: string | null
  canceled_at: string | null
  ended_at: string | null
  trial_start: string | null
  trial_end: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}
