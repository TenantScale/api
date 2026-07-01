// ──────────────────────────────────────────────────────
// Pagination helpers
// Framework-agnostic — no dependencies on @tenantscale/sdk
// ──────────────────────────────────────────────────────

import type { Context } from 'hono'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export interface PaginationParams {
  page: number
  limit: number
  offset: number
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  total_pages: number
}

/**
 * Parse pagination parameters from a Hono context's query params.
 */
export function getPaginationParams(
  c: Context,
  defaultLimit = 50,
): PaginationParams {
  const raw: Record<string, string | undefined> = {}
  for (const [key, val] of Object.entries(c.req.queries() ?? {})) {
    raw[key] = val?.[0]
  }
  return parsePagination(raw, defaultLimit)
}

/**
 * Parse pagination from a plain key-value object.
 */
export function getPaginationParamsFromQuery(
  query: Record<string, string | undefined>,
  defaultLimit = 50,
): PaginationParams {
  return parsePagination(query, defaultLimit)
}

function parsePagination(
  query: Record<string, string | undefined>,
  defaultLimit: number,
): PaginationParams {
  const rawPage = parseInt(query['page'] ?? '', 10)
  const rawLimit = parseInt(query['limit'] ?? '', 10)

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : DEFAULT_PAGE
  const limit = Number.isFinite(rawLimit) && rawLimit >= 1
    ? Math.min(rawLimit, MAX_LIMIT)
    : defaultLimit

  return { page, limit, offset: (page - 1) * limit }
}

/**
 * Build a pagination response metadata object.
 */
export function paginationResponse(
  page: number,
  limit: number,
  total: number,
): PaginationMeta {
  return {
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
  }
}
