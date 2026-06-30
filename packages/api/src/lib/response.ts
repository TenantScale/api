// ──────────────────────────────────────────────────────
// Response helpers — reduces boilerplate error handling
// ──────────────────────────────────────────────────────

import type { Context } from 'hono'

/** Standard error response envelope used across all endpoints */
export interface ApiError {
  error: string
  code?: string
}

/**
 * Handle a Supabase error response.
 * Returns a consistent JSON error with HTTP 500.
 */
export function supabaseError(c: Context, error: { message: string } | null, code = 'DB_ERROR'): Response | Promise<Response> {
  return c.json({ error: error?.message ?? 'Unknown error', code }, 500)
}
