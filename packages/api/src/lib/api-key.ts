// ──────────────────────────────────────────────────────
// API Key utilities — inlined from @tenantscale/sdk
// ──────────────────────────────────────────────────────

import { createHash, randomBytes } from 'node:crypto'

const API_KEY_PREFIX = 'tk_'

/** Generate a new API key (tk_ prefix + random token) */
export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`
  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const keyPrefix = rawKey.slice(0, 8)
  return { rawKey, keyHash, keyPrefix }
}

/** Hash a raw API key for storage */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

/** Check if a string looks like a valid API key format */
export function isValidApiKeyFormat(key: string): boolean {
  return key.startsWith(API_KEY_PREFIX) && key.length > API_KEY_PREFIX.length + 10
}
