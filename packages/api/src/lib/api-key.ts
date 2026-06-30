// ──────────────────────────────────────────────────────
// API Key utilities — delegates to @tenantscale/sdk
// ──────────────────────────────────────────────────────

import { generateApiKey as sdkGenerateApiKey, hashApiKey as sdkHashApiKey, isValidApiKeyFormat as sdkIsValidFormat } from '@tenantscale/sdk'

/** Generate a new API key (tk_ prefix + random token) */
export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  return sdkGenerateApiKey()
}

/** Hash a raw API key for storage */
export function hashApiKey(rawKey: string): string {
  return sdkHashApiKey(rawKey)
}

/** Check if a string looks like a valid API key format */
export function isValidApiKeyFormat(key: string): boolean {
  return sdkIsValidFormat(key)
}
