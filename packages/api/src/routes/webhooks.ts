// ──────────────────────────────────────────────────────
// Webhook Routes — manage webhook endpoint configurations
// Available via admin API key (admin scope) or portal session (owner/admin)
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { supabase } from '../db/supabase.js'
import { requireApiKey, requireScope } from '../middleware/auth.js'
import { requirePortalSession, requirePortalRole, getSession } from '../middleware/session-auth.js'
import type { PortalSession } from '../middleware/session-auth.js'
import { requirePlanFeature } from '../middleware/plan-enforcement.js'
import { getPaginationParams, paginationResponse } from '../lib/pagination.js'
import { supabaseError } from '../lib/response.js'
import { logAuditEvent } from '../lib/audit.js'
import { ssrfUrlCheck } from './schemas.js'

export const webhookRoutes = new Hono()

// ── Event types ──

export const WEBHOOK_EVENTS = [
  'tenant.created',
  'tenant.updated',
  'tenant.deleted',
  'user.invited',
  'user.removed',
  'user.role_changed',
  'api_key.created',
  'api_key.revoked',
  'plan.changed',
] as const

// ── Schemas ──

export const createWebhookSchema = z.object({
  url: z.string().url('Must be a valid URL').refine(ssrfUrlCheck, 'Webhook URL must point to a public internet address'),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Select at least one event'),
  description: z.string().max(200).default(''),
})

export const updateWebhookSchema = z.object({
  url: z.string().url().refine(ssrfUrlCheck, 'Webhook URL must point to a public internet address').optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  description: z.string().max(200).optional(),
  is_active: z.boolean().optional(),
})

// ── Webhook select fields (never return the secret) ──
const WEBHOOK_LIST_FIELDS = 'id, url, events, description, is_active, created_at, updated_at'
const WEBHOOK_CREATE_FIELDS = 'id, url, events, description, is_active, secret, created_at'
const WEBHOOK_UPDATE_FIELDS = 'id, url, events, description, is_active, updated_at'

// ════════════════════════════════════════════════════════════════
// Admin API: CRUD webhooks
// ════════════════════════════════════════════════════════════════

webhookRoutes.get('/admin/tenants/:id/webhooks', requireApiKey, requireScope('admin'), async (c) => {
  const tenantId = c.req.param('id')

  const { data: webhooks, error } = await supabase
    .from('webhooks')
    .select(WEBHOOK_LIST_FIELDS)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  if (error) return supabaseError(c, error)
  return c.json({ webhooks })
})

webhookRoutes.post('/admin/tenants/:id/webhooks', requireApiKey, requireScope('admin'), requirePlanFeature('webhooks'), zValidator('json', createWebhookSchema), async (c) => {
  const tenantId = c.req.param('id')
  const body = c.req.valid('json')

  const { data: webhook, error } = await supabase
    .from('webhooks')
    .insert({ tenant_id: tenantId, url: body.url, events: body.events, description: body.description })
    .select(WEBHOOK_CREATE_FIELDS)
    .single()

  if (error) return supabaseError(c, error)

  return c.json({ ...webhook, warning: 'Save the secret — it will not be shown again' }, 201)
})

webhookRoutes.patch('/admin/tenants/:id/webhooks/:webhookId', requireApiKey, requireScope('admin'), zValidator('json', updateWebhookSchema), async (c) => {
  const { id: tenantId, webhookId } = c.req.param()
  const body = c.req.valid('json')

  const { data: webhook, error } = await supabase
    .from('webhooks')
    .update(body)
    .eq('id', webhookId)
    .eq('tenant_id', tenantId)
    .select(WEBHOOK_UPDATE_FIELDS)
    .single()

  if (error) return supabaseError(c, error)
  if (!webhook) return c.json({ error: 'Webhook not found' }, 404)

  return c.json(webhook)
})

webhookRoutes.delete('/admin/tenants/:id/webhooks/:webhookId', requireApiKey, requireScope('admin'), async (c) => {
  const { id: tenantId, webhookId } = c.req.param()

  const { error } = await supabase
    .from('webhooks')
    .delete()
    .eq('id', webhookId)
    .eq('tenant_id', tenantId)

  if (error) return supabaseError(c, error)
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// Portal API: tenant self-service webhook management
// ════════════════════════════════════════════════════════════════

webhookRoutes.get('/portal/webhooks', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)
  if (!session.tenant_id) return c.json({ webhooks: [] })

  const { data: webhooks, error } = await supabase
    .from('webhooks')
    .select(WEBHOOK_LIST_FIELDS)
    .eq('tenant_id', session.tenant_id)
    .order('created_at', { ascending: false })

  if (error) return supabaseError(c, error)
  return c.json({ webhooks })
})

webhookRoutes.post('/portal/webhooks', requirePortalSession, requirePortalRole('owner', 'admin'), requirePlanFeature('webhooks'), zValidator('json', createWebhookSchema), async (c) => {
  const session: PortalSession = getSession(c)
  const body = c.req.valid('json')

  if (!session.tenant_id) return c.json({ error: 'No tenant associated with your account' }, 400)

  const { data: webhook, error } = await supabase
    .from('webhooks')
    .insert({ tenant_id: session.tenant_id, url: body.url, events: body.events, description: body.description })
    .select(WEBHOOK_CREATE_FIELDS)
    .single()

  if (error) return supabaseError(c, error)

  await logAuditEvent({
    tenant_id: session.tenant_id,
    actor_id: session.user_id,
    actor_type: 'user',
    action: 'webhook.created',
    resource: `webhook:${webhook.id}`,
    details: { url: body.url, events: body.events },
  })

  return c.json({ ...webhook, warning: 'Save the secret — it will not be shown again' }, 201)
})

webhookRoutes.patch('/portal/webhooks/:id', requirePortalSession, requirePortalRole('owner', 'admin'), zValidator('json', updateWebhookSchema), async (c) => {
  const session: PortalSession = getSession(c)
  const webhookId = c.req.param('id')
  const body = c.req.valid('json')

  const { data: webhook, error } = await supabase
    .from('webhooks')
    .update(body)
    .eq('id', webhookId)
    .eq('tenant_id', session.tenant_id)
    .select(WEBHOOK_UPDATE_FIELDS)
    .single()

  if (error) return supabaseError(c, error)
  if (!webhook) return c.json({ error: 'Webhook not found' }, 404)

  return c.json(webhook)
})

webhookRoutes.delete('/portal/webhooks/:id', requirePortalSession, requirePortalRole('owner', 'admin'), async (c) => {
  const session: PortalSession = getSession(c)
  const webhookId = c.req.param('id')

  const { error } = await supabase
    .from('webhooks')
    .delete()
    .eq('id', webhookId)
    .eq('tenant_id', session.tenant_id)

  if (error) return supabaseError(c, error)
  return c.json({ success: true })
})

// ════════════════════════════════════════════════════════════════
// Delivery log
// ════════════════════════════════════════════════════════════════

webhookRoutes.get('/portal/webhooks/:id/deliveries', requirePortalSession, requirePortalRole('owner', 'admin'), async (c) => {
  const session: PortalSession = getSession(c)
  const webhookId = c.req.param('id')
  const { page, limit, offset } = getPaginationParams(c, 20)

  const { data: hook } = await supabase
    .from('webhooks')
    .select('id')
    .eq('id', webhookId)
    .eq('tenant_id', session.tenant_id)
    .single()

  if (!hook) return c.json({ error: 'Webhook not found' }, 404)

  const { data: deliveries, error, count } = await supabase
    .from('webhook_deliveries')
    .select('id, event_type, response_status, status, error_message, duration_ms, created_at', { count: 'exact' })
    .eq('webhook_id', webhookId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return supabaseError(c, error)

  return c.json({
    deliveries,
    pagination: paginationResponse(page, limit, count ?? 0),
  })
})
