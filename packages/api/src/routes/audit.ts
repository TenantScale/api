// ──────────────────────────────────────────────────────
// Audit routes — used by the SDK to log events
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { supabase } from '../db/supabase'
import { createAuditEventSchema } from './schemas'
import { requireApiKey } from '../middleware/auth'
import { getPaginationParams, paginationResponse } from '../lib/pagination'
import { supabaseError } from '../lib/response'

export const auditRoutes = new Hono()

// ── Log an audit event (from SDK) ──
auditRoutes.post('/audit', requireApiKey, zValidator('json', createAuditEventSchema), async (c) => {
  const body = c.req.valid('json')
  const apiKey = c.get('apiKey')

  const { data: event, error } = await supabase
    .from('audit_events')
    .insert({
      tenant_id: apiKey.tenant_id,
      actor_id: body.actor_id ?? null,
      actor_type: 'user',
      action: body.action,
      resource: body.resource,
      details: body.details ?? {},
      ip: c.req.header('x-forwarded-for') ?? c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    })
    .select()
    .single()

  if (error) return supabaseError(c, error)

  return c.json(event, 201)
})

// ── Get audit events for the current tenant ──
auditRoutes.get('/audit', requireApiKey, async (c) => {
  const apiKey = c.get('apiKey')
  const { page, limit, offset } = getPaginationParams(c)

  const { data: events, error, count } = await supabase
    .from('audit_events')
    .select('*', { count: 'exact' })
    .eq('tenant_id', apiKey.tenant_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return supabaseError(c, error)

  return c.json({
    events,
    pagination: paginationResponse(page, limit, count ?? 0),
  })
})
