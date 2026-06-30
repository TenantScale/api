// ──────────────────────────────────────────────────────
// Stripe Webhook Handler
// ──────────────────────────────────────────────────────
// Mounted at POST /stripe/webhook — outside the v1 namespace
// so it skips API key auth, plan rate limiting, and CORS.
// Stripe signature verification replaces standard auth.
//
// Events handled:
//   checkout.session.completed   → Activate subscription + upgrade plan
//   customer.subscription.updated → Sync status + handle plan changes
//   customer.subscription.deleted → Downgrade tenant to Free
//   invoice.paid                 → Update current_period_end
//   invoice.payment_failed       → Log (grace period handles the rest)
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { logger } from '../lib/logger'
import { constructWebhookEvent, resolvePlanFromPrice, mapSubscriptionStatus, stripe } from '../lib/stripe'
import { supabase } from '../db/supabase'
import { invalidatePlanCache } from '../lib/plan-store'
import { logAuditEvent } from '../lib/audit'

export const stripeWebhookRoutes = new Hono()

// ════════════════════════════════════════════════════════════════
// POST /stripe/webhook
// ════════════════════════════════════════════════════════════════

stripeWebhookRoutes.post('/stripe/webhook', async (c) => {
  // ── 1. Verify signature ──
  const signature = c.req.header('stripe-signature')
  if (!signature) {
    logger.warn('[Stripe] Webhook missing stripe-signature header')
    return c.json({ error: 'Missing signature' }, 401)
  }

  const rawBody = await c.req.text()

  // Check configuration before attempting verification
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    logger.warn('[Stripe] STRIPE_WEBHOOK_SECRET not configured — webhooks disabled')
    return c.json({ error: 'Webhook verification not configured on server' }, 503)
  }

  const event = constructWebhookEvent(rawBody, signature)
  if (!event) {
    logger.warn('[Stripe] Webhook signature verification failed')
    // Distinguish 401 (bad client signature) from 503 (server misconfig)
    return c.json({ error: 'Invalid signature' }, 401)
  }

  logger.info({ eventType: event.type, eventId: event.id }, '[Stripe] Webhook received')

  // ── 2. Route by event type ──
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as StripeCheckoutSession)
        break

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as StripeSubscription)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as StripeSubscription)
        break

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as StripeInvoice)
        break

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as StripeInvoice)
        break

      default:
        logger.debug({ eventType: event.type }, '[Stripe] Unhandled event type — acknowledged')
    }

    return c.json({ received: true, event_id: event.id })
  } catch (err) {
    logger.error({ err, eventType: event.type, eventId: event.id }, '[Stripe] Webhook handler error')
    // Return 200 to Stripe even on error to prevent retry storms.
    // The error is logged and will be investigated manually.
    return c.json({ received: true, warning: 'Handler error — logged' })
  }
})

// ── Event handler types ──

interface StripeCheckoutSession {
  id: string
  customer: string
  subscription: string | null
  metadata: Record<string, string>
  client_reference_id?: string
  mode: string
}

interface StripeSubscription {
  id: string
  customer: string
  status: string
  items: {
    data: Array<{
      price: { id: string }
    }>
  }
  current_period_start: number
  current_period_end: number
  canceled_at: number | null
  ended_at: number | null
  trial_start: number | null
  trial_end: number | null
  metadata: Record<string, string>
  cancel_at_period_end: boolean
}

interface StripeInvoice {
  id: string
  subscription: string | null
  customer: string
  status: string
  paid: boolean
  amount_paid: number
  period_start: number
  period_end: number
  lines?: {
    data: Array<{
      price?: { id: string }
    }>
  }
}

// ════════════════════════════════════════════════════════════════
// Event handlers
// ════════════════════════════════════════════════════════════════

/**
 * checkout.session.completed
 *
 * A checkout session was completed successfully. This means the
 * customer went through Stripe Checkout and their subscription
 * was created. We create a subscription record in our DB and
 * upgrade the tenant's plan.
 */
async function handleCheckoutCompleted(session: StripeCheckoutSession) {
  const tenantId = session.metadata?.tenant_id
  if (!tenantId) {
    logger.warn({ sessionId: session.id }, '[Stripe] Checkout session missing tenant_id metadata')
    return
  }

  if (!session.subscription) {
    logger.warn({ sessionId: session.id }, '[Stripe] Checkout session has no subscription')
    return
  }

  // Fetch the subscription from Stripe to get full details
  const subscription = await stripe.subscriptions.retrieve(session.subscription as string)

  if (!subscription.items.data[0]?.price?.id) {
    logger.warn({ subscriptionId: session.subscription }, '[Stripe] Subscription has no price')
    return
  }

  const priceId = subscription.items.data[0].price.id
  const planInfo = resolvePlanFromPrice(priceId)

  if (!planInfo) {
    logger.warn({ priceId, subscriptionId: session.subscription }, '[Stripe] Unknown price ID — plan not found')
    return
  }

  const billingInterval = (session.metadata.billing_interval as 'month' | 'year') ?? planInfo.interval

  // Idempotency check: has this subscription already been recorded?
  const { data: existingSub } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('stripe_subscription_id', session.subscription)
    .maybeSingle()

  if (existingSub) {
    logger.info({ subscriptionId: session.subscription }, '[Stripe] Subscription already recorded — skipping')
    return
  }

  // ── Insert subscription record ──
  const { error: insertError } = await supabase
    .from('subscriptions')
    .insert({
      tenant_id: tenantId,
      stripe_subscription_id: session.subscription,
      stripe_customer_id: session.customer,
      stripe_price_id: priceId,
      status: mapSubscriptionStatus(subscription.status),
      plan_id: planInfo.planId,
      billing_interval: billingInterval,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      metadata: { checkout_session_id: session.id },
    })

  if (insertError) {
    logger.error({ insertError, subscriptionId: session.subscription }, '[Stripe] Failed to insert subscription')
    throw insertError
  }

  // ── Upgrade tenant plan ──
  const { error: updateError } = await supabase
    .from('tenants')
    .update({ plan_id: planInfo.planId })
    .eq('id', tenantId)

  if (updateError) {
    logger.error({ updateError, tenantId, planId: planInfo.planId }, '[Stripe] Failed to upgrade tenant plan')
    throw updateError
  }

  // Invalidate plan cache so enforcement picks up the new plan immediately
  invalidatePlanCache(tenantId)

  // Log audit event
  await logAuditEvent({
    tenant_id: tenantId,
    actor_type: 'system',
    action: 'subscription.activated',
    resource: `subscription:${session.subscription}`,
    details: {
      plan_id: planInfo.planId,
      billing_interval: billingInterval,
      price_id: priceId,
    },
  })

  logger.info({ tenantId, planId: planInfo.planId, subscriptionId: session.subscription },
    '[Stripe] Subscription activated — tenant upgraded')
}

/**
 * customer.subscription.updated
 *
 * Subscription changed — could be plan upgrade, downgrade (scheduled
 * for period end), status change (past_due, canceled), or renewal.
 *
 * For downgrades at period end: the plan_id stays until the current
 * period ends. We only change it when checkout.session.completed fires
 * for the new plan, or when subscription.deleted fires.
 */
async function handleSubscriptionUpdated(subscription: StripeSubscription) {
  const priceId = subscription.items.data[0]?.price?.id
  if (!priceId) return

  const planInfo = resolvePlanFromPrice(priceId)
  if (!planInfo) {
    logger.warn({ priceId, subscriptionId: subscription.id }, '[Stripe] Unknown price in subscription update')
    return
  }

  const newStatus = mapSubscriptionStatus(subscription.status as StripeSubscription['status'])

  // Check if tenant_id is in subscription metadata (set at creation)
  let tenantId = subscription.metadata?.tenant_id

  if (!tenantId) {
    // Fallback: look up by stripe_customer_id
    const { data: customer } = await supabase
      .from('stripe_customers')
      .select('tenant_id')
      .eq('stripe_customer_id', subscription.customer)
      .maybeSingle()

    if (!customer) {
      logger.warn({ customerId: subscription.customer }, '[Stripe] No tenant found for customer')
      return
    }
    tenantId = customer.tenant_id
  }

  // Update subscription record
  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({
      stripe_price_id: priceId,
      status: newStatus,
      plan_id: planInfo.planId,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      ended_at: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id)

  if (updateError) {
    logger.error({ updateError, subscriptionId: subscription.id }, '[Stripe] Failed to update subscription')
    return
  }

  // If status changed to active (e.g. from incomplete or past_due), ensure plan is set
  if (newStatus === 'active' || newStatus === 'trialing') {
    const { error: planUpdateError } = await supabase
      .from('tenants')
      .update({ plan_id: planInfo.planId })
      .eq('id', tenantId)

    if (planUpdateError) {
      logger.error({ planUpdateError, tenantId }, '[Stripe] Failed to sync plan on subscription update')
      return
    }

    invalidatePlanCache(tenantId)
  }

  logger.info({ tenantId, subscriptionId: subscription.id, status: newStatus, planId: planInfo.planId },
    '[Stripe] Subscription updated')
}

/**
 * customer.subscription.deleted
 *
 * Subscription was canceled or expired. Downgrade tenant to Free
 * at end of period (which Stripe handles). This fires when the
 * subscription actually ends.
 */
async function handleSubscriptionDeleted(subscription: StripeSubscription) {
  let tenantId = subscription.metadata?.tenant_id

  if (!tenantId) {
    const { data: customer } = await supabase
      .from('stripe_customers')
      .select('tenant_id')
      .eq('stripe_customer_id', subscription.customer)
      .maybeSingle()

    if (!customer) {
      logger.warn({ customerId: subscription.customer }, '[Stripe] No tenant found for deleted subscription')
      return
    }
    tenantId = customer.tenant_id
  }

  // Update subscription record
  const { error: subUpdateError } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      ended_at: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id)

  if (subUpdateError) {
    logger.error({ subUpdateError, subscriptionId: subscription.id }, '[Stripe] Failed to mark subscription canceled')
  }

  // Downgrade tenant to Free
  const { error: tenantUpdateError } = await supabase
    .from('tenants')
    .update({ plan_id: 'free' })
    .eq('id', tenantId)

  if (tenantUpdateError) {
    logger.error({ tenantUpdateError, tenantId }, '[Stripe] Failed to downgrade tenant on subscription deletion')
    return
  }

  invalidatePlanCache(tenantId)

  await logAuditEvent({
    tenant_id: tenantId,
    actor_type: 'system',
    action: 'subscription.canceled',
    resource: `subscription:${subscription.id}`,
    details: {
      reason: 'subscription_deleted',
    },
  })

  logger.info({ tenantId, subscriptionId: subscription.id }, '[Stripe] Tenant downgraded to Free')
}

/**
 * invoice.paid
 *
 * A subscription invoice was paid successfully. Update the
 * subscription's current_period_end to reflect the new period.
 */
async function handleInvoicePaid(invoice: StripeInvoice) {
  if (!invoice.subscription) return

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'active',
      current_period_start: new Date(invoice.period_start * 1000).toISOString(),
      current_period_end: new Date(invoice.period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', invoice.subscription)

  if (error) {
    logger.error({ error, subscriptionId: invoice.subscription }, '[Stripe] Failed to update subscription after paid invoice')
  }
}

/**
 * invoice.payment_failed
 *
 * Payment failed. Stripe will retry automatically.
 * We update the subscription status to past_due.
 * If it remains unpaid after the grace period, Stripe will
 * eventually mark it as unpaid and fire subscription.deleted.
 */
async function handleInvoicePaymentFailed(invoice: StripeInvoice) {
  if (!invoice.subscription) return

  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', invoice.subscription)

  if (error) {
    logger.error({ error, subscriptionId: invoice.subscription }, '[Stripe] Failed to mark subscription past_due')
  }

  logger.warn({ subscriptionId: invoice.subscription, invoiceId: invoice.id },
    '[Stripe] Invoice payment failed — subscription past_due')
}
