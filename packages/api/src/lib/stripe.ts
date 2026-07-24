// ──────────────────────────────────────────────────────
// Stripe — shared client and helpers
// ──────────────────────────────────────────────────────
// Lazily-initialized singleton. All env-var lookups happen
// at first call so the app doesn't crash at import time if
// STRIPE_SECRET_KEY isn't set yet (e.g. in tests).
// ──────────────────────────────────────────────────────

import Stripe from 'stripe'
import { logger } from './logger.js'

// ── Price ID configuration ──
// Set these env vars to the price IDs created by setup-stripe-products.ts.
// Format: STRIPE_PRICE_{PLAN}_{INTERVAL}
//   PLAN    = HOBBY | PRO | SCALE
//   INTERVAL = MONTH | YEAR

export interface PlanPriceMapping {
  monthly: string | undefined
  yearly: string | undefined
}

const PRICE_ENV_MAP: Record<string, PlanPriceMapping> = {
  hobby: {
    monthly: process.env.STRIPE_PRICE_HOBBY_MONTH,
    yearly: process.env.STRIPE_PRICE_HOBBY_YEAR,
  },
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTH,
    yearly: process.env.STRIPE_PRICE_PRO_YEAR,
  },
  scale: {
    monthly: process.env.STRIPE_PRICE_SCALE_MONTH,
    yearly: process.env.STRIPE_PRICE_SCALE_YEAR,
  },
}

/**
 * Get the Stripe price ID for a given plan and billing interval.
 */
export function getPriceId(planId: string, interval: 'month' | 'year'): string | undefined {
  const mapping = PRICE_ENV_MAP[planId]
  if (!mapping) return undefined
  return interval === 'month' ? mapping.monthly : mapping.yearly
}

/**
 * Resolve a Stripe price ID back to its plan ID and billing interval.
 */
export function resolvePlanFromPrice(priceId: string): { planId: string; interval: 'month' | 'year' } | null {
  for (const [planId, prices] of Object.entries(PRICE_ENV_MAP)) {
    if (prices.monthly === priceId) return { planId, interval: 'month' }
    if (prices.yearly === priceId) return { planId, interval: 'year' }
  }
  return null
}

// ── Stripe client singleton ──

let _stripe: Stripe | null = null

function getStripe(): Stripe {
  if (_stripe) return _stripe

  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY must be set in environment to use billing features'
    )
  }

  _stripe = new Stripe(key, {
    apiVersion: '2026-06-24.dahlia',
    typescript: true,
    maxNetworkRetries: 2,
    timeout: 15_000,
  })

  return _stripe
}

export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    const client = getStripe()
    const value = (client as any)[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})

// ── Customer helpers ──

/**
 * Get or create a Stripe Customer for a tenant.
 * Looks up an existing mapping first to avoid duplicates.
 *
 * @param tenantId - Internal TenantScale tenant UUID
 * @param email - Optional email for the Stripe Customer (from portal session)
 * @param name - Optional name for the Stripe Customer (tenant name)
 * @returns Stripe Customer ID
 */
export async function getOrCreateStripeCustomer(
  tenantId: string,
  email?: string,
  name?: string,
): Promise<string> {
  const { supabase } = await import('../db/supabase')

  // Check existing mapping
  const { data: existing } = await supabase
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (existing?.stripe_customer_id) {
    return existing.stripe_customer_id
  }

  // Create customer in Stripe
  const customer = await getStripe().customers.create({
    email,
    name,
    metadata: { tenant_id: tenantId },
  })

  // Store mapping
  const { error: insertError } = await supabase
    .from('stripe_customers')
    .insert({
      tenant_id: tenantId,
      stripe_customer_id: customer.id,
    })

  if (insertError) {
    logger.warn({ tenantId, error: insertError }, 'Failed to persist Stripe customer mapping')
    // Continue — mapping loss is recoverable
  }

  logger.info({ tenantId, stripeCustomerId: customer.id }, 'Created Stripe customer')
  return customer.id
}

// ── Checkout Session ──

export interface CreateCheckoutOptions {
  tenantId: string
  customerEmail?: string
  tenantName?: string
  priceId: string
  billingInterval: 'month' | 'year'
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, string>
}

/**
 * Create a Stripe Checkout Session for a tenant subscription.
 * Automatically resolves or creates the Stripe Customer.
 */
export async function createCheckoutSession(opts: CreateCheckoutOptions) {
  const customerId = await getOrCreateStripeCustomer(
    opts.tenantId,
    opts.customerEmail,
    opts.tenantName,
  )

  const session = await getStripe().checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price: opts.priceId,
        quantity: 1,
      },
    ],
    metadata: {
      tenant_id: opts.tenantId,
      billing_interval: opts.billingInterval,
      ...opts.metadata,
    },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    subscription_data: {
      metadata: {
        tenant_id: opts.tenantId,
        billing_interval: opts.billingInterval,
      },
    },
  })

  return session
}

// ── Billing Portal ──

export interface CreatePortalOptions {
  tenantId: string
  returnUrl: string
}

/**
 * Create a Stripe Customer Portal session so the customer can
 * manage their subscription, payment methods, and invoices.
 */
export async function createBillingPortalSession(opts: CreatePortalOptions) {
  const { supabase } = await import('../db/supabase')

  const { data: customer } = await supabase
    .from('stripe_customers')
    .select('stripe_customer_id')
    .eq('tenant_id', opts.tenantId)
    .maybeSingle()

  if (!customer?.stripe_customer_id) {
    throw new Error('No Stripe customer found for this tenant')
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: opts.returnUrl,
  })

  return session
}

// ── Webhook verification ──

/**
 * Construct a verified Stripe webhook event from the raw request body
 * and signature header. Returns null if verification fails.
 */
export function constructWebhookEvent(
  body: string | Buffer,
  signature: string,
): Stripe.Event | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    logger.warn('[Stripe] STRIPE_WEBHOOK_SECRET not configured — webhook verification disabled')
    return null
  }

  try {
    return getStripe().webhooks.constructEvent(body, signature, secret)
  } catch (err) {
    logger.warn({ err }, '[Stripe] Webhook signature verification failed')
    return null
  }
}

// ── Subscription status mapping ──

/**
 * Map a Stripe subscription status to our DB enum.
 */
export function mapSubscriptionStatus(
  stripeStatus: string,
): 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'trialing' | 'paused' {
  // Stripe's possible values: active | past_due | unpaid | canceled | incomplete | incomplete_expired | trialing | paused
  switch (stripeStatus) {
    case 'active': return 'active'
    case 'past_due': return 'past_due'
    case 'canceled': return 'canceled'
    case 'unpaid': return 'unpaid'
    case 'incomplete': return 'incomplete'
    case 'incomplete_expired': return 'incomplete_expired'
    case 'trialing': return 'trialing'
    case 'paused': return 'paused'
    default: return 'incomplete'
  }
}
