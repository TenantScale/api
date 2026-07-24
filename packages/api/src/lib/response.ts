// ──────────────────────────────────────────────────────
// Response helpers — reduces boilerplate error handling
// ──────────────────────────────────────────────────────

import type { Context, StatusCode } from 'hono'

/** Standard error response envelope used across all endpoints */
export interface ApiError {
  error: string
  code?: string
}

/**
 * Map common Postgres error codes to HTTP status codes.
 * See: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const POSTGRES_ERROR_CODES: Record<string, number> = {
  '23505': 409, // unique_violation
  '23503': 409, // foreign_key_violation
  '23502': 400, // not_null_violation
  '23514': 400, // check_violation
  '42P01': 500, // undefined_table
  '42703': 400, // undefined_column
  '22001': 400, // string_data_right_truncation
  '22003': 400, // numeric_value_out_of_range
  '22P02': 400, // invalid_text_representation
  '53000': 503, // insufficient_resources (disk full, etc.)
  '57P01': 503, // admin_shutdown
  '40001': 409, // serialization_failure
  '40P01': 409, // deadlock_detected
  'PGRST116': 404, // Supabase: no rows returned
}

/**
 * Handle a Supabase error response.
 * Returns a consistent JSON error with an HTTP status derived from the
 * Postgres error code, falling back to 500 for unknown errors.
 */
export function supabaseError(
  c: Context,
  error: { message: string; code?: string } | null,
  defaultCode = 'DB_ERROR',
): Response | Promise<Response> {
  const status = error?.code ? POSTGRES_ERROR_CODES[error.code] ?? 500 : 500
  return c.json({ error: error?.message ?? 'Unknown error', code: error?.code ?? defaultCode }, status as StatusCode)
}
