// ──────────────────────────────────────────────────────
// Portal: /portal/api-keys — API key management endpoints
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { supabase } from '../../db/supabase.js'
import { createPortalApiKeySchema } from '../schemas.js'
import { requirePortalSession, requirePortalRole, getSession } from '../../middleware/session-auth.js'
import type { PortalSession } from '../../middleware/session-auth.js'
import { supabaseError } from '../../lib/response.js'
import { logAuditEvent } from '../../lib/audit.js'
import { generateApiKey } from '../../lib/api-key.js'

export const apiKeysRoutes = new Hono()

// ── GET /portal/api-keys — List API keys for the tenant ──
apiKeysRoutes.get('/portal/api-keys', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)

  const { data: keys, error } = await supabase
    .from('api_keys')
    .select('id, label, key_prefix, scopes, is_active, expires_at, last_used_at, created_at, created_by')
    .eq('tenant_id', session.tenant_id)
    .order('created_at', { ascending: false })

  if (error) return supabaseError(c, error)

  return c.json({ api_keys: keys })
})

// ── POST /portal/api-keys — Create a new API key ──
apiKeysRoutes.post('/portal/api-keys', requirePortalSession, requirePortalRole('owner', 'admin'), zValidator('json', createPortalApiKeySchema), async (c) => {
  const session: PortalSession = getSession(c)
  const body = c.req.valid('json')

  const { rawKey, keyHash, keyPrefix } = generateApiKey()

  const { data: apiKey, error } = await supabase
    .from('api_keys')
    .insert({
      tenant_id: session.tenant_id,
      label: body.label,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: body.scopes,
      created_by: session.user_id,
    })
    .select()
    .single()

  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'api_key.created',
    resource: `api_key:${apiKey.id}`,
    details: { label: body.label, key_prefix: keyPrefix, created_by: session.email },
  })

  return c.json({ ...apiKey, raw_key: rawKey }, 201)
})

// ── DELETE /portal/api-keys/:id — Revoke an API key ──
apiKeysRoutes.delete('/portal/api-keys/:id', requirePortalSession, requirePortalRole('owner', 'admin'), async (c) => {
  const session: PortalSession = getSession(c)
  const keyId = c.req.param('id')

  const { data: key } = await supabase
    .from('api_keys')
    .select('*')
    .eq('id', keyId)
    .eq('tenant_id', session.tenant_id)
    .single()

  if (!key) return c.json({ error: 'API key not found' }, 404)

  const { error } = await supabase
    .from('api_keys')
    .update({ is_active: false })
    .eq('id', keyId)

  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id!,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'api_key.revoked',
    resource: `api_key:${keyId}`,
    details: { label: key.label, revoked_by: session.email },
  })

  return c.json({ success: true })
})
