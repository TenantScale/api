// ──────────────────────────────────────────────────────
// TenantScale SDK — singleton for the Hono API
// ──────────────────────────────────────────────────────
//
// Lazily initialized once with supabase URL and key.
// All middleware and lib files import this instead of creating
// their own SDK instances.

import { TenantScale } from '@tenantscale/sdk'

let _ts: TenantScale | null = null

/**
 * Get the global TenantScale SDK instance.
 * Initialized lazily on first access.
 */
export function getSdk(): TenantScale {
  if (_ts) return _ts
  _ts = new TenantScale({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  } as any)
  return _ts
}
