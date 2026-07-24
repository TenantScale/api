// ──────────────────────────────────────────────────────
// Error codes — single source of truth for API error codes
// Every error response should use one of these codes.
// ──────────────────────────────────────────────────────

/**
 * Centralized error codes used across all API endpoints.
 * Each code maps to a specific error condition that clients
 * can handle programmatically.
 */
export const ErrorCode = {
  // ── Generic ──
  DB_ERROR: 'DB_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // ── Auth / Session ──
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  SESSION_INVALID: 'SESSION_INVALID',

  // ── Rate limiting ──
  RATE_LIMITED: 'RATE_LIMITED',
  DAILY_LIMIT_EXCEEDED: 'DAILY_LIMIT_EXCEEDED',

  // ── Plans / Billing ──
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  INVALID_PLAN: 'INVALID_PLAN',
  PLAN_FEATURE_SSO: 'PLAN_FEATURE_SSO',
  STRIPE_NOT_CONFIGURED: 'STRIPE_NOT_CONFIGURED',

  // ── Resources ──
  CONFLICT: 'CONFLICT',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/**
 * Helper to create a consistent error response body.
 */
export function apiError(error: string, code: ErrorCode = ErrorCode.DB_ERROR) {
  return { error, code }
}
