// ──────────────────────────────────────────────────────
// Pagination helpers — delegates to @tenantscale/sdk
// ──────────────────────────────────────────────────────

import { parsePaginationParams as sdkParsePagination, paginationResponse as sdkPaginationResponse } from '@tenantscale/sdk'

/**
 * Parse pagination parameters from query params object.
 * Returns normalized { page, limit, offset }.
 */
export function getPaginationParams(
  query: Record<string, string | undefined>,
  defaultLimit = 50,
) {
  return sdkParsePagination(query, defaultLimit)
}

/**
 * Build a pagination response envelope with metadata.
 */
export function paginationResponse<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): { data: T[]; pagination: { page: number; limit: number; total: number; total_pages: number } } {
  const meta = sdkPaginationResponse(page, limit, total)
  return { data: items, pagination: meta }
}
