// ──────────────────────────────────────────────────────
// TenantScale SDK — singleton for the Hono API
// ──────────────────────────────────────────────────────
//
// Lazily initialized once with the existing Supabase admin client.
// All middleware and lib files import this instead of creating
// their own SDK instances.

import { TenantScale } from '@tenantscale/sdk'
import { supabase } from '../db/supabase'

let _ts: TenantScale | null = null

/**
 * Get the global TenantScale SDK instance.
 * Initialized lazily on first access.
 */
export function getSdk(): TenantScale {
  if (_ts) return _ts
  _ts = new TenantScale({ supabase })
  return _ts
}
