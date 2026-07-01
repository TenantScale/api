// ──────────────────────────────────────────────────────
// TenantScale API — Response Helpers Tests
// ──────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest'
import { supabaseError } from '../lib/response'

/**
 * Factory to create a mock Hono context with a spied `json` method.
 * We store `lastStatus` and `lastBody` so tests can assert the response
 * without relying on the return value's type shape.
 */
function mockC() {
  const calls: Array<{ body: unknown; status: number }> = []
  const json = vi.fn().mockImplementation((body: unknown, status: number) => {
    calls.push({ body, status })
    return new Response(JSON.stringify(body), { status })
  })
  return { json, _calls: calls } as unknown as Parameters<typeof supabaseError>[0]
}

// ════════════════════════════════════════════════════════════════
// supabaseError
// ════════════════════════════════════════════════════════════════

describe('supabaseError', () => {
  // ── Happy Path ──
  // Test: Basic error → returns 500 with error message
  // Category: Happy Path
  // What it proves: A basic error object produces a 500 response with its message
  // Risk if missing: Production code would swallow error messages
  it('returns 500 with error message for a basic error', () => {
    const c = mockC()
    supabaseError(c, { message: 'Something went wrong' })
    expect(c.json).toHaveBeenCalledTimes(1)
    expect(c.json).toHaveBeenCalledWith(
      { error: 'Something went wrong', code: 'DB_ERROR' },
      500,
    )
  })

  // Test: Custom default code
  // Category: Happy Path
  // What it proves: The caller can override the default error code string
  // Risk if missing: Callers can't distinguish error sources without custom codes
  it('returns 500 with custom default code', () => {
    const c = mockC()
    supabaseError(c, { message: 'DB timeout' }, 'TIMEOUT_ERR')
    expect(c.json).toHaveBeenCalledWith(
      { error: 'DB timeout', code: 'TIMEOUT_ERR' },
      500,
    )
  })

  // Test: Postgres code in body (takes precedence)
  // Category: Happy Path
  // What it proves: When a Postgres code exists, it's used as the body code (not defaultCode)
  // Risk if missing: Clients lose the original Postgres error code
  it('uses the Postgres code in body (not overwritten by defaultCode)', () => {
    const c = mockC()
    supabaseError(c, { message: 'Unique violation', code: '23505' }, 'FALLBACK')
    expect(c.json).toHaveBeenCalledWith(
      { error: 'Unique violation', code: '23505' },
      409,
    )
  })

  // ── Postgres error code mapping ──
  // Test: Postgres code '23505' (unique_violation) → 409
  // Category: Happy Path
  // What it proves: Unique violation maps to HTTP 409 Conflict
  // Risk if missing: Duplicate resources would return 500 instead of 409
  it('maps code 23505 (unique_violation) to 409', () => {
    const c = mockC()
    supabaseError(c, { message: 'Duplicate entry', code: '23505' })
    expect(c.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Duplicate entry' }),
      409,
    )
  })

  // Test: Postgres code '23503' (foreign_key_violation) → 409
  // Category: Happy Path
  // What it proves: Foreign key violation maps to HTTP 409 Conflict
  // Risk if missing: Referential integrity errors would return 500 instead of 409
  it('maps code 23503 (foreign_key_violation) to 409', () => {
    const c = mockC()
    supabaseError(c, { message: 'Referenced row not found', code: '23503' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 409)
  })

  // Test: Postgres code '23502' (not_null_violation) → 400
  // Category: Happy Path
  // What it proves: Not-null violation maps to HTTP 400 Bad Request
  // Risk if missing: Validation errors would return 500 instead of 400
  it('maps code 23502 (not_null_violation) to 400', () => {
    const c = mockC()
    supabaseError(c, { message: 'Field cannot be null', code: '23502' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 400)
  })

  // Test: Postgres code '23514' (check_violation) → 400
  // Category: Happy Path
  // What it proves: Check constraint violation maps to HTTP 400
  // Risk if missing: Constraint errors would return 500 instead of 400
  it('maps code 23514 (check_violation) to 400', () => {
    const c = mockC()
    supabaseError(c, { message: 'Check constraint failed', code: '23514' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 400)
  })

  // Test: Postgres code 'PGRST116' (no rows) → 404
  // Category: Happy Path
  // What it proves: "No rows" from Supabase maps to HTTP 404 Not Found
  // Risk if missing: Missing resources would return 500 instead of 404
  it('maps code PGRST116 (no rows) to 404', () => {
    const c = mockC()
    supabaseError(c, { message: 'No rows returned', code: 'PGRST116' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 404)
  })

  // Test: Postgres code '53000' (insufficient_resources) → 503
  // Category: Happy Path
  // What it proves: Insufficient resources maps to HTTP 503 Service Unavailable
  // Risk if missing: Resource exhaustion would return 500 instead of 503
  it('maps code 53000 (insufficient_resources) to 503', () => {
    const c = mockC()
    supabaseError(c, { message: 'Disk full', code: '53000' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 503)
  })

  // Test: Postgres code '57P01' (admin_shutdown) → 503
  // Category: Happy Path
  // What it proves: Admin shutdown maps to HTTP 503
  // Risk if missing: Shutdown errors would get wrong status code
  it('maps code 57P01 (admin_shutdown) to 503', () => {
    const c = mockC()
    supabaseError(c, { message: 'Server shutting down', code: '57P01' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 503)
  })

  // Test: Postgres code '42P01' (undefined_table) → 500
  // Category: Happy Path
  // What it proves: Undefined table maps to HTTP 500
  // Risk if missing: Schema errors would get wrong status code
  it('maps code 42P01 (undefined_table) to 500', () => {
    const c = mockC()
    supabaseError(c, { message: 'Relation does not exist', code: '42P01' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 500)
  })

  // Test: Postgres code '42703' (undefined_column) → 400
  // Category: Happy Path
  // What it proves: Undefined column maps to HTTP 400
  // Risk if missing: Column errors would return 500 instead of 400
  it('maps code 42703 (undefined_column) to 400', () => {
    const c = mockC()
    supabaseError(c, { message: 'Column not found', code: '42703' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 400)
  })

  // Test: Postgres code '22001' (string_data_right_truncation) → 400
  // Category: Happy Path
  // What it proves: String truncation maps to HTTP 400
  // Risk if missing: Truncation errors would return 500 instead of 400
  it('maps code 22001 (string_data_right_truncation) to 400', () => {
    const c = mockC()
    supabaseError(c, { message: 'Value too long', code: '22001' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 400)
  })

  // Test: Postgres code '22003' (numeric_value_out_of_range) → 400
  // Category: Happy Path
  // What it proves: Numeric overflow maps to HTTP 400
  // Risk if missing: Numeric errors would return 500 instead of 400
  it('maps code 22003 (numeric_value_out_of_range) to 400', () => {
    const c = mockC()
    supabaseError(c, { message: 'Numeric overflow', code: '22003' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 400)
  })

  // Test: Postgres code '22P02' (invalid_text_representation) → 400
  // Category: Happy Path
  // What it proves: Invalid text maps to HTTP 400
  // Risk if missing: Input format errors would return 500 instead of 400
  it('maps code 22P02 (invalid_text_representation) to 400', () => {
    const c = mockC()
    supabaseError(c, { message: 'Invalid input syntax', code: '22P02' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 400)
  })

  // Test: Postgres code '40001' (serialization_failure) → 409
  // Category: Happy Path
  // What it proves: Serialization failure maps to HTTP 409
  // Risk if missing: Transaction conflicts would return 500 instead of 409
  it('maps code 40001 (serialization_failure) to 409', () => {
    const c = mockC()
    supabaseError(c, { message: 'Serialization failure', code: '40001' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 409)
  })

  // Test: Postgres code '40P01' (deadlock_detected) → 409
  // Category: Happy Path
  // What it proves: Deadlock maps to HTTP 409
  // Risk if missing: Deadlock errors would return 500 instead of 409
  it('maps code 40P01 (deadlock_detected) to 409', () => {
    const c = mockC()
    supabaseError(c, { message: 'Deadlock', code: '40P01' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 409)
  })

  // ── Unknown / fallback ──
  // Test: Unknown Postgres code → 500
  // Category: Unhappy Path
  // What it proves: Unrecognized Postgres codes fall back to HTTP 500
  // Risk if missing: Unknown errors would crash or return wrong status
  it('falls back to 500 for unknown Postgres codes', () => {
    const c = mockC()
    supabaseError(c, { message: 'Unknown pg error', code: 'XX000' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 500)
  })

  // Test: No code present → 500
  // Category: Unhappy Path
  // What it proves: When no code field exists, response is 500 with DB_ERROR
  // Risk if missing: Errors without codes would break or return wrong status
  it('falls back to 500 when no code is present', () => {
    const c = mockC()
    supabaseError(c, { message: 'Generic error' })
    expect(c.json).toHaveBeenCalledWith(
      { error: 'Generic error', code: 'DB_ERROR' },
      500,
    )
  })

  // Test: Null code → treated as 500
  // Category: Unhappy Path
  // What it proves: Null code is treated as no code (500, defaultCode used)
  // Risk if missing: null code could crash or leak internals
  it('falls back to 500 for error with null code', () => {
    const c = mockC()
    supabaseError(c, { message: 'Error with null code', code: null as unknown as string })
    expect(c.json).toHaveBeenCalledWith(
      { error: 'Error with null code', code: 'DB_ERROR' },
      500,
    )
  })

  // Test: No error object (null) → 500 with 'Unknown error'
  // Category: Error Handling
  // What it proves: null error is safely handled without crashing
  // Risk if missing: A null error would throw a TypeError
  it('handles null error object (returns 500 with "Unknown error")', () => {
    const c = mockC()
    supabaseError(c, null)
    expect(c.json).toHaveBeenCalledWith(
      { error: 'Unknown error', code: 'DB_ERROR' },
      500,
    )
  })

  // Test: Undefined error → 500 with 'Unknown error'
  // Category: Error Handling
  // What it proves: undefined error is safely handled
  // Risk if missing: undefined would cause a crash
  it('handles undefined error gracefully', () => {
    const c = mockC()
    supabaseError(c, undefined as unknown as null)
    expect(c.json).toHaveBeenCalledWith(
      { error: 'Unknown error', code: 'DB_ERROR' },
      500,
    )
  })

  // Test: Error with undefined message → code still maps, message becomes 'Unknown error'
  // Category: Error Handling
  // What it proves: When message is undefined but code exists, status maps correctly and body uses 'Unknown error'
  // Risk if missing: undefined message would show "undefined" in response
  it('handles error with undefined message', () => {
    const c = mockC()
    supabaseError(c, { message: undefined as unknown as string, code: '23505' })
    expect(c.json).toHaveBeenCalledWith(
      { error: 'Unknown error', code: '23505' },
      409,
    )
  })

  // Test: Error with empty message string → 500
  // Category: Unhappy Path
  // What it proves: Empty message string is passed through (not overwritten)
  // Risk if missing: Empty error messages would be confusing
  it('passes through empty message string', () => {
    const c = mockC()
    supabaseError(c, { message: '' })
    expect(c.json).toHaveBeenCalledWith(
      { error: '', code: 'DB_ERROR' },
      500,
    )
  })

  // Test: Non-existent code → falls back to 500
  // Category: Unhappy Path
  // What it proves: Any code not in the map falls back to 500
  // Risk if missing: New Postgres codes could return wrong status
  it('falls back to 500 for non-existent code in map', () => {
    const c = mockC()
    supabaseError(c, { message: 'Custom error', code: 'CUSTOM123' })
    expect(c.json).toHaveBeenCalledWith(expect.anything(), 500)
  })

  // ── Error handling / propagation ──
  // Test: c.json is called with the exact expected arguments
  // Category: Happy Path
  // What it proves: The function correctly delegates to context.json
  // Risk if missing: Refactoring could break the delegation pattern silently
  it('calls c.json with the correct arguments for known code', () => {
    const c = mockC()
    supabaseError(c, { message: 'Not found', code: 'PGRST116' })
    expect(c.json).toHaveBeenCalledWith(
      { error: 'Not found', code: 'PGRST116' },
      404,
    )
  })

  // Test: Default code used when no code on error
  // Category: Happy Path
  // What it proves: defaultCode appears in body when error has no code
  // Risk if missing: Clients wouldn't get a consistent error code field
  it('calls c.json with default code when no code on error', () => {
    const c = mockC()
    supabaseError(c, { message: 'Broken' })
    expect(c.json).toHaveBeenCalledWith(
      { error: 'Broken', code: 'DB_ERROR' },
      500,
    )
  })

  // Test: Custom default code used
  // Category: Happy Path
  // What it proves: Caller-supplied defaultCode overrides 'DB_ERROR'
  // Risk if missing: Error sources can't be distinguished without custom codes
  it('calls c.json with custom default code parameter', () => {
    const c = mockC()
    supabaseError(c, { message: 'Fail' }, 'MY_CODE')
    expect(c.json).toHaveBeenCalledWith(
      { error: 'Fail', code: 'MY_CODE' },
      500,
    )
  })
})
