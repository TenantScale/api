// ──────────────────────────────────────────────────────
// Subscription Routes — customer-facing billing endpoints
// ──────────────────────────────────────────────────────
// All routes require portal session auth.
//
// POST /v1/portal/create-checkout-session
//   → Creates a Stripe Checkout Session for upgrading to a paid plan
//   → Returns { url } for redirect
//
// POST /v1/portal/billing-portal
//   → Creates a Stripe Customer Portal session for managing billing
//   → Returns { url } for redirect
//
// GET /v1/portal/subscription
//   → Returns the tenant's current subscription details
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requirePortalSession, requirePortalRole, getSession } from '../middleware/session-auth'
import type { PortalSession } from '../middleware/session-auth'
import { createCheckoutSession, createBillingPortalSession } from '../lib/stripe'
import { getPriceId } from '../lib/stripe'
import { supabase } from '../db/supabase'
import { logger } from '../lib/logger'

export const subscriptionRoutes = new Hono()

// ── Schema ──

const createCheckoutSchema = z.object({
  plan_id: z.enum(['hobby', 'pro', 'scale'], {
    message: 'Plan must be one of: hobby, pro, scale',
  }),
  billing_interval: z.enum(['month', 'year']).default('month'),
})

// ════════════════════════════════════════════════════════════════
// POST /portal/create-checkout-session
// ════════════════════════════════════════════════════════════════
// Creates a Stripe Checkout Session and returns the redirect URL.
// Requires owner role (only the owner can change billing).
// ════════════════════════════════════════════════════════════════

subscriptionRoutes.post(
  '/portal/create-checkout-session',
  requirePortalSession,
  requirePortalRole('owner'),
  zValidator('json', createCheckoutSchema),
  async (c) => {
    const session: PortalSession = getSession(c)
    const body = c.req.valid('json')

    if (!session.tenant_id) {
      return c.json({ error: 'No tenant associated with your account' }, 400)
    }

    // Resolve Stripe price ID
    const priceId = getPriceId(body.plan_id, body.billing_interval)
    if (!priceId) {
      return c.json({
        error: `Billing not configured for ${body.plan_id} (${body.billing_interval}). Run 'pnpm stripe:setup-products' first.`,
        code: 'STRIPE_NOT_CONFIGURED',
      }, 500)
    }

    // Build URLs from env or request origin
    const successUrl = process.env.STRIPE_SUCCESS_URL ?? `${c.req.header('origin') ?? 'http://localhost:3001'}/portal/billing?success=true`
    const cancelUrl = process.env.STRIPE_CANCEL_URL ?? `${c.req.header('origin') ?? 'http://localhost:3001'}/portal/billing?canceled=true`

    try {
      const checkoutSession = await createCheckoutSession({
        tenantId: session.tenant_id,
        customerEmail: session.email,
        tenantName: session.tenant_name ?? undefined,
        priceId,
        billingInterval: body.billing_interval,
        successUrl,
        cancelUrl,
        metadata: {
          tenant_id: session.tenant_id,
          billing_interval: body.billing_interval,
        },
      })

      return c.json({ url: checkoutSession.url })
    } catch (err) {
      logger.error({ err, tenantId: session.tenant_id, planId: body.plan_id },
        '[Billing] Failed to create checkout session')
      return c.json({ error: 'Failed to create checkout session. Check Stripe configuration.' }, 500)
    }
  },
)

// ════════════════════════════════════════════════════════════════
// POST /portal/billing-portal
// ════════════════════════════════════════════════════════════════
// Creates a Stripe Customer Portal session for managing billing.
// Requires owner role.
// ════════════════════════════════════════════════════════════════

subscriptionRoutes.post(
  '/portal/billing-portal',
  requirePortalSession,
  requirePortalRole('owner'),
  async (c) => {
    const session: PortalSession = getSession(c)

    if (!session.tenant_id) {
      return c.json({ error: 'No tenant associated with your account' }, 400)
    }

    const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL
      ?? `${c.req.header('origin') ?? 'http://localhost:3001'}/portal/settings`

    try {
      const portalSession = await createBillingPortalSession({
        tenantId: session.tenant_id,
        returnUrl,
      })

      return c.json({ url: portalSession.url })
    } catch (err) {
      if (err instanceof Error && err.message === 'No Stripe customer found for this tenant') {
        return c.json({ error: 'No billing account found. Subscribe to a plan first.' }, 400)
      }

      logger.error({ err, tenantId: session.tenant_id },
        '[Billing] Failed to create billing portal session')
      return c.json({ error: 'Failed to open billing portal' }, 500)
    }
  },
)

// ════════════════════════════════════════════════════════════════
// GET /portal/subscription
// ════════════════════════════════════════════════════════════════
// Returns the tenant's current subscription status.
// Any team member can view this.
// ════════════════════════════════════════════════════════════════

subscriptionRoutes.get(
  '/portal/subscription',
  requirePortalSession,
  async (c) => {
    const session: PortalSession = getSession(c)

    if (!session.tenant_id) {
      return c.json({ subscription: null })
    }

    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('tenant_id', session.tenant_id)
      .in('status', ['active', 'past_due', 'trialing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.error({ error, tenantId: session.tenant_id }, '[Billing] Failed to fetch subscription')
      return c.json({ error: 'Failed to fetch subscription' }, 500)
    }

    if (!subscription) {
      return c.json({ subscription: null })
    }

    // Get the plan details
    const { data: plan } = await supabase
      .from('plans')
      .select('name')
      .eq('id', subscription.plan_id)
      .single()

    return c.json({
      subscription: {
        id: subscription.id,
        status: subscription.status,
        plan_id: subscription.plan_id,
        plan_name: plan?.name ?? subscription.plan_id,
        billing_interval: subscription.billing_interval,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.metadata?.cancel_at_period_end ?? false,
      },
    })
  },
)
