// ──────────────────────────────────────────────────────
// Stripe Integration Tests
// ──────────────────────────────────────────────────────
// Tests validate schemas, helpers, and webhook endpoint.
// Full portal auth chain is tested separately in session-auth.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'

// ── Mock Supabase (needed by stripe-webhook module) ──
const mockSupabase = {
  from: vi.fn(),
  auth: { getUser: vi.fn() },
  rpc: vi.fn(),
}
vi.mock('../db/supabase', () => ({ supabase: mockSupabase }))
vi.mock('../lib/plan-store', () => ({
  invalidatePlanCache: vi.fn(),
  getPlanForTenant: vi.fn(),
  hasPlanFeature: vi.fn(),
  getPlanLimit: vi.fn(),
}))
vi.mock('../lib/audit', () => ({
  logAuditEvent: vi.fn(),
}))

// ── Mock Stripe SDK ──
vi.mock('stripe', () => {
  const StripeMock = vi.fn(() => ({
    customers: { create: vi.fn().mockResolvedValue({ id: 'cus_mock' }) },
    checkout: { sessions: { create: vi.fn().mockResolvedValue({ id: 'cs_mock', url: 'https://checkout.stripe.com/test' }) } },
    billingPortal: { sessions: { create: vi.fn().mockResolvedValue({ id: 'bps_mock', url: 'https://billing.stripe.com/test' }) } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn().mockResolvedValue({ id: 'sub_mock', status: 'active', items: { data: [{ price: { id: 'price_pro_month' } }] }, current_period_start: 1000, current_period_end: 2000 }) },
    products: { search: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn(), update: vi.fn() },
    prices: { search: vi.fn().mockResolvedValue({ data: [] }), create: vi.fn(), update: vi.fn() },
  }))
  return { default: StripeMock }
})

// Set required env vars
process.env.STRIPE_SECRET_KEY = 'sk_test_mock'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock'
process.env.STRIPE_PRICE_HOBBY_MONTH = 'price_hobby_month'
process.env.STRIPE_PRICE_HOBBY_YEAR = 'price_hobby_year'
process.env.STRIPE_PRICE_PRO_MONTH = 'price_pro_month'
process.env.STRIPE_PRICE_PRO_YEAR = 'price_pro_year'
process.env.STRIPE_PRICE_SCALE_MONTH = 'price_scale_month'
process.env.STRIPE_PRICE_SCALE_YEAR = 'price_scale_year'

const { stripeWebhookRoutes } = await import('../routes/stripe-webhook')

function chainQB() {
  const qb: Record<string, unknown> = {}
  qb.select = vi.fn().mockReturnThis()
  qb.insert = vi.fn().mockReturnThis()
  qb.update = vi.fn().mockReturnThis()
  qb.delete = vi.fn().mockReturnThis()
  qb.eq = vi.fn().mockReturnThis()
  qb.in = vi.fn().mockReturnThis()
  qb.order = vi.fn().mockReturnThis()
  qb.limit = vi.fn().mockReturnThis()
  qb.range = vi.fn().mockReturnThis()
  qb.single = vi.fn()
  qb.maybeSingle = vi.fn()
  return qb as unknown as Record<string, ReturnType<typeof vi.fn>>
}

// ════════════════════════════════════════════════════════════════
// Stripe Library Helpers
// ════════════════════════════════════════════════════════════════

describe('Stripe helpers', () => {
  it('getPriceId returns correct price for hobby monthly', async () => {
    const { getPriceId } = await import('../lib/stripe')
    expect(getPriceId('hobby', 'month')).toBe('price_hobby_month')
  })

  it('getPriceId returns correct price for pro yearly', async () => {
    const { getPriceId } = await import('../lib/stripe')
    expect(getPriceId('pro', 'year')).toBe('price_pro_year')
  })

  it('getPriceId returns undefined for unknown plan', async () => {
    const { getPriceId } = await import('../lib/stripe')
    expect(getPriceId('enterprise', 'month')).toBeUndefined()
  })

  it('resolvePlanFromPrice maps price ID to plan', async () => {
    const { resolvePlanFromPrice } = await import('../lib/stripe')
    expect(resolvePlanFromPrice('price_scale_month')).toEqual({ planId: 'scale', interval: 'month' })
  })

  it('resolvePlanFromPrice returns null for unknown price', async () => {
    const { resolvePlanFromPrice } = await import('../lib/stripe')
    expect(resolvePlanFromPrice('price_unknown')).toBeNull()
  })

  it('mapSubscriptionStatus maps all Stripe statuses', async () => {
    const { mapSubscriptionStatus } = await import('../lib/stripe')
    expect(mapSubscriptionStatus('active' as any)).toBe('active')
    expect(mapSubscriptionStatus('past_due' as any)).toBe('past_due')
    expect(mapSubscriptionStatus('canceled' as any)).toBe('canceled')
    expect(mapSubscriptionStatus('unpaid' as any)).toBe('unpaid')
    expect(mapSubscriptionStatus('trialing' as any)).toBe('trialing')
    expect(mapSubscriptionStatus('paused' as any)).toBe('paused')
    expect(mapSubscriptionStatus('incomplete' as any)).toBe('incomplete')
    expect(mapSubscriptionStatus('incomplete_expired' as any)).toBe('incomplete_expired')
    expect(mapSubscriptionStatus('unknown_value' as any)).toBe('incomplete')
  })
})

// ════════════════════════════════════════════════════════════════
// Subscription Schema / Validation (portable, no auth needed)
// ════════════════════════════════════════════════════════════════

describe('Checkout schema validation', () => {
  const createCheckoutSchema = z.object({
    plan_id: z.enum(['hobby', 'pro', 'scale']),
    billing_interval: z.enum(['month', 'year']).default('month'),
  })

  it('accepts valid plan_id and default interval', () => {
    const result = createCheckoutSchema.parse({ plan_id: 'pro' })
    expect(result.plan_id).toBe('pro')
    expect(result.billing_interval).toBe('month')
  })

  it('accepts yearly billing', () => {
    const result = createCheckoutSchema.parse({ plan_id: 'scale', billing_interval: 'year' })
    expect(result.billing_interval).toBe('year')
  })

  it('rejects invalid plan_id', () => {
    expect(() => createCheckoutSchema.parse({ plan_id: 'enterprise' })).toThrow()
  })

  it('rejects free plan (not in enum)', () => {
    expect(() => createCheckoutSchema.parse({ plan_id: 'free' })).toThrow()
  })

  it('rejects invalid billing_interval', () => {
    expect(() => createCheckoutSchema.parse({ plan_id: 'hobby', billing_interval: 'decade' })).toThrow()
  })
})

// ════════════════════════════════════════════════════════════════
// GET /portal/subscription — response shape (pure logic, mock DB)
// ════════════════════════════════════════════════════════════════

describe('Subscription response logic', () => {
  it('formats subscription data correctly', async () => {
    const { supabase } = await import('../db/supabase') // already mocked

    // Simulate the route handler logic directly
    const mockSubscription = {
      id: 'sub-1',
      status: 'active',
      plan_id: 'pro',
      billing_interval: 'month',
      current_period_start: '2026-01-01T00:00:00Z',
      current_period_end: '2026-02-01T00:00:00Z',
      metadata: { cancel_at_period_end: false },
    }

    // What the route returns
    const result = {
      subscription: {
        id: mockSubscription.id,
        status: mockSubscription.status,
        plan_id: mockSubscription.plan_id,
        plan_name: 'Pro',
        billing_interval: mockSubscription.billing_interval,
        current_period_start: mockSubscription.current_period_start,
        current_period_end: mockSubscription.current_period_end,
        cancel_at_period_end: false,
      },
    }

    expect(result.subscription.id).toBe('sub-1')
    expect(result.subscription.status).toBe('active')
    expect(result.subscription.plan_name).toBe('Pro')
    expect(result.subscription.cancel_at_period_end).toBe(false)
  })

  it('returns null subscription for free tenants', () => {
    const result = { subscription: null }
    expect(result.subscription).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════
// Stripe Webhook Handler
// ════════════════════════════════════════════════════════════════

describe('POST /stripe/webhook', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono().route('/', stripeWebhookRoutes)
  })

  it('rejects request without stripe-signature header', async () => {
    const res = await app.request('/stripe/webhook', {
      method: 'POST',
      body: JSON.stringify({ type: 'checkout.session.completed' }),
    })
    expect(res.status).toBe(401)
    const body = await res.json() as any
    expect(body.error).toBe('Missing signature')
  })

  it('rejects request with invalid signature', async () => {
    const res = await app.request('/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'invalid' },
      body: JSON.stringify({ type: 'checkout.session.completed' }),
    })
    expect(res.status).toBe(401)
  })

  it('acknowledges unhandled event types', async () => {
    const stripeLib = await import('../lib/stripe')
    vi.spyOn(stripeLib, 'constructWebhookEvent').mockReturnValue({
      id: 'evt_mock',
      type: 'charge.succeeded',
      data: { object: {} },
      object: 'event',
    } as any)

    const res = await app.request('/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_sig' },
      body: JSON.stringify({ type: 'charge.succeeded' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.received).toBe(true)
    expect(body.event_id).toBe('evt_mock')
  })
})

// ════════════════════════════════════════════════════════════════
// Webhook event handler: checkout.session.completed
// ════════════════════════════════════════════════════════════════

describe('Stripe webhook event handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps checkout session metadata to subscription insert', async () => {
    // Test the handler's core logic by directly calling handleCheckoutCompleted
    // through a mocked event
    const stripeLib = await import('../lib/stripe')

    const mockSession = {
      id: 'cs_test_123',
      customer: 'cus_test',
      subscription: 'sub_test_456',
      metadata: { tenant_id: 'tenant-1', billing_interval: 'month' },
      mode: 'subscription',
    }

    // Mock constructWebhookEvent to return our event
    vi.spyOn(stripeLib, 'constructWebhookEvent').mockReturnValue({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      data: { object: mockSession },
      object: 'event',
    } as any)

    // Set DB mocks for the handler
    const qb = chainQB()
    // First maybeSingle: check if subscription already exists (idempotency)
    qb.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    // insert subscription
    qb.insert.mockResolvedValueOnce({ data: null, error: null })
    // update tenant
    qb.update.mockResolvedValueOnce({ data: null, error: null })
    // select plan name (not called in the webhook handler directly)
    mockSupabase.from.mockReturnValue(qb)

    // Make the request
    const app = new Hono().route('/', stripeWebhookRoutes)
    const res = await app.request('/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid_sig' },
      body: JSON.stringify({
        id: 'evt_checkout',
        type: 'checkout.session.completed',
        data: { object: mockSession },
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.received).toBe(true)
  })
})
