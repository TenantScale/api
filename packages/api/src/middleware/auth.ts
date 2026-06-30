// ──────────────────────────────────────────────────────
// Auth middleware — validates API keys via @tenantscale/sdk
// ──────────────────────────────────────────────────────

import type { Context, Next } from 'hono'
import type { ApiKeyContext } from '../env'

/**
 * Hono middleware that validates Authorization: Bearer <token>
 * and attaches the resolved API key to context.
 */
export async function requireApiKey(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization header' }, 401)
  }

  const rawKey = authHeader.slice(7).trim()
  if (!rawKey) {
    return c.json({ error: 'Empty API key' }, 401)
  }

  try {
    const sdk = getSdk()
    const keyInfo = await sdk.validateApiKey(rawKey)

    c.set('apiKey', {
      raw: keyInfo.raw,
      tenant_id: keyInfo.tenant_id,
      scopes: keyInfo.scopes,
      created_by: keyInfo.created_by,
    } satisfies ApiKeyContext)

    await next()
  } catch (err) {
    const err_ = err as { statusCode?: number; message?: string; code?: string }
    const status = err_.statusCode ?? 401
    return c.json({
      error: err_.message ?? 'Invalid API key',
      code: err_.code ?? 'AUTH_FAILED',
    }, status as 401 | 403)
  }
}

/**
 * Middleware factory that restricts to specific scopes.
 */
export function requireScope(...scopes: string[]) {
  return async (c: Context, next: Next) => {
    const apiKey: ApiKeyContext = c.get('apiKey')

    // Inline scope check — avoids creating a fake ApiKeyInfo object
    // and doesn't depend on SDK internals.
    const hasScope = scopes.some(s => apiKey.scopes.includes(s))
    if (!hasScope) {
      return c.json({
        error: `This endpoint requires one of these scopes: ${scopes.join(', ')}`,
      }, 403)
    }

    await next()
  }
}
