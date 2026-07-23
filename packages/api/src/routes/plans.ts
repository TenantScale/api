// ──────────────────────────────────────────────────────
// Plan routes — query plan tiers and limits
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { supabase } from '../db/supabase.js'
import { updatePlanSchema } from './schemas.js'
import { requireApiKey, requireScope } from '../middleware/auth.js'
import { supabaseError } from '../lib/response.js'

export const planRoutes = new Hono()

// ── List all plans (authenticated users) ──
planRoutes.get('/plans', requireApiKey, async (c) => {
  const { data: plans, error } = await supabase
    .from('plans')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) return supabaseError(c, error)

  return c.json({ plans })
})

// ── Get single plan by ID ──
planRoutes.get('/plans/:id', requireApiKey, async (c) => {
  const id = c.req.param('id')

  const { data: plan, error } = await supabase
    .from('plans')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !plan) {
    return c.json({ error: 'Plan not found' }, 404)
  }

  return c.json(plan)
})

// ── Update plan features/limits (admin only) ──
planRoutes.patch('/plans/:id', requireApiKey, requireScope('admin'), zValidator('json', updatePlanSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const { data: plan, error } = await supabase
    .from('plans')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return supabaseError(c, error)
  if (!plan) return c.json({ error: 'Plan not found' }, 404)

  return c.json(plan)
})
