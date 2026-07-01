// ──────────────────────────────────────────────────────
// Auth middleware — validates API keys against Supabase
// ──────────────────────────────────────────────────────

import type { Context, Next } from 'hono'
import type { ApiKeyContext } from '../env'
import { supabase } from '../db/supabase'
import { hashApiKey } from '../lib/api-key'

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
    const keyHash = hashApiKey(rawKey)

    const { data: keyRecord, error } = await supabase
      .from('api_keys')
      .select('id, tenant_id, scopes, created_by, is_active, expires_at, tenant:tenants!inner(is_active)')
      .eq('key_hash', keyHash)
      .maybeSingle()

    if (error || !keyRecord) {
      return c.json({ error: 'Invalid API key' }, 401)
    }

    if (!keyRecord.is_active) {
      return c.json({ error: 'API key is disabled' }, 403)
    }

    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return c.json({ error: 'API key has expired' }, 403)
    }

    // Check tenant is active
    const tenant = keyRecord.tenant as unknown as { is_active: boolean }
    if (!tenant?.is_active) {
      return c.json({ error: 'Tenant account is inactive' }, 403)
    }

    c.set('apiKey', {
      raw: rawKey.slice(0, 8) + '...',
      tenant_id: keyRecord.tenant_id,
      scopes: keyRecord.scopes,
      created_by: keyRecord.created_by,
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
