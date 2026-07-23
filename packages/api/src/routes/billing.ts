// ──────────────────────────────────────────────────────
// Billing routes — usage metering, seat counting, overage preview
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requirePortalSession, getSession } from '../middleware/session-auth.js'
import type { PortalSession } from '../middleware/session-auth.js'
import { supabase } from '../db/supabase.js'
import {
  getUsageTotals,
  getProjectedOverage,
  syncUsageToStripe,
  syncSeatsToStripe,
} from '../lib/usage-billing.js'
import { getPriceId } from '../lib/stripe.js'
import { logger } from '../lib/logger.js'

export const billingRoutes = new Hono()

// ── Schemas ──

const syncUsageSchema = z.object({
  tenant_id: z.string().uuid(),
  metric: z.string().default('api_call'),
  stripe_price_id: z.string().optional(),
  subscription_item_id: z.string(),
})

const syncSeatsSchema = z.object({
  tenant_id: z.string().uuid(),
  stripe_seat_price_id: z.string().optional(),
  subscription_item_id: z.string(),
})

// ════════════════════════════════════════════════════════════════
// GET /portal/billing/usage
// ════════════════════════════════════════════════════════════════
// Returns current billing period usage totals, plan limits,
// overage rates, and projected costs.
// ════════════════════════════════════════════════════════════════

billingRoutes.get('/portal/billing/usage', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)

  if (!session.tenant_id) {
    return c.json({ error: 'No tenant associated' }, 400)
  }

  try {
    const totals = await getUsageTotals(session.tenant_id)
    const overage = getProjectedOverage(totals)

    return c.json({
      ...totals,
      projected_overage: overage,
    })
  } catch (err) {
    logger.error({ err, tenantId: session.tenant_id }, '[Billing] Failed to get usage totals')
    return c.json({ error: 'Failed to load usage data' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════
// POST /admin/cron/sync-usage-to-stripe
// ════════════════════════════════════════════════════════════════
// Cron-triggered endpoint that syncs metered usage to Stripe
// for tenants with metered billing enabled.
// Auth: requires CRON_SECRET
// ════════════════════════════════════════════════════════════════

billingRoutes.post('/admin/cron/sync-usage-to-stripe', async (c) => {
  const cronSecret = c.req.header('X-Cron-Secret')
  if (cronSecret !== process.env.CRON_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Find all tenants with active subscriptions on metered plans
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('id, tenant_id, plan_id, stripe_subscription_id')
    .in('status', ['active', 'trialing'])

  if (!subscriptions || subscriptions.length === 0) {
    return c.json({ synced: 0, message: 'No active subscriptions to sync' })
  }

  let synced = 0
  let failed = 0

  for (const sub of subscriptions) {
    const subData = sub as unknown as {
      id: string
      tenant_id: string
      plan_id: string
      stripe_subscription_id: string | null
    }

    if (!subData.stripe_subscription_id) continue

    // Check if the plan has metered pricing
    const { data: plan } = await supabase
      .from('plans')
      .select('stripe_metered_price_id, stripe_seat_price_id')
      .eq('id', subData.plan_id)
      .single()

    if (!plan) continue

    const planData = plan as unknown as {
      stripe_metered_price_id: string | null
      stripe_seat_price_id: string | null
    }

    // Get the subscription items to find the right item IDs
    try {
      const { stripe } = await import('../lib/stripe.js')

      // Fetch subscription items from Stripe to get item IDs
      const stripeSub = await stripe.subscriptions.retrieve(subData.stripe_subscription_id)
      const items = stripeSub.items.data

      // Sync API call usage
      if (planData.stripe_metered_price_id) {
        const meteredItem = items.find(
          (item: { price: { id: string } }) => item.price.id === planData.stripe_metered_price_id,
        )
        if (meteredItem) {
          const ok = await syncUsageToStripe(
            subData.tenant_id,
            'api_call',
            planData.stripe_metered_price_id,
            meteredItem.id,
          )
          if (ok) synced++
          else failed++
        }
      }

      // Sync seat usage
      if (planData.stripe_seat_price_id) {
        const seatItem = items.find(
          (item: { price: { id: string } }) => item.price.id === planData.stripe_seat_price_id,
        )
        if (seatItem) {
          const ok = await syncSeatsToStripe(
            subData.tenant_id,
            planData.stripe_seat_price_id,
            seatItem.id,
          )
          if (ok) synced++
          else failed++
        }
      }
    } catch (err) {
      logger.error({ err, tenantId: subData.tenant_id }, '[Cron] Failed to sync tenant usage')
      failed++
    }
  }

  logger.info({ synced, failed, total: subscriptions.length }, '[Cron] Usage sync complete')

  return c.json({
    synced,
    failed,
    total: subscriptions.length,
  })
})

// ════════════════════════════════════════════════════════════════
// GET /admin/cron/sync-usage-to-stripe (dry-run)
// ════════════════════════════════════════════════════════════════
// Returns which tenants would be synced, without actually syncing.
// Auth: requires CRON_SECRET
// ════════════════════════════════════════════════════════════════

billingRoutes.get('/admin/cron/sync-usage-to-stripe', async (c) => {
  const cronSecret = c.req.header('X-Cron-Secret')
  if (cronSecret !== process.env.CRON_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('id, tenant_id, plan_id, status')
    .in('status', ['active', 'trialing'])

  return c.json({
    tenants: (subscriptions ?? []).map((s: unknown) => {
      const sub = s as { id: string; tenant_id: string; plan_id: string; status: string }
      return { tenant_id: sub.tenant_id, plan_id: sub.plan_id, status: sub.status }
    }),
    total: subscriptions?.length ?? 0,
  })
})
