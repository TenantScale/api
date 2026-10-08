// ──────────────────────────────────────────────────────
// Setup Stripe Products & Prices
// ──────────────────────────────────────────────────────
// Run once after deploying to create Stripe products for
// each TenantScale plan tier (Hobby, Pro, Scale).
//
// Creates both monthly and yearly prices for each plan.
// Outputs the price IDs that should be added to .env as:
//   STRIPE_PRICE_HOBBY_MONTH=price_xxx
//   STRIPE_PRICE_HOBBY_YEAR=price_xxx
//   STRIPE_PRICE_PRO_MONTH=price_xxx
//   STRIPE_PRICE_PRO_YEAR=price_xxx
//   STRIPE_PRICE_SCALE_MONTH=price_xxx
//   STRIPE_PRICE_SCALE_YEAR=price_xxx
//
// Usage:
//   pnpm stripe:setup-products
//   # or: tsx src/scripts/setup-stripe-products.ts
//
// Behavior:
//   - Idempotent: re-running picks up where it left off (products
//     and prices are matched by plan metadata and reused).
//   - Retries transient Stripe errors (429 rate limits, 5xx, and
//     connection/timeout errors) with exponential backoff.
//   - Reports partial success/failure per plan and exits non-zero
//     if any plan failed, so CI/scripts can react.
// ──────────────────────────────────────────────────────

import Stripe from 'stripe'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
if (!STRIPE_SECRET_KEY) {
  console.error(
    '❌ STRIPE_SECRET_KEY environment variable must be set.\n' +
      '   Add it to your .env file or export it before running:\n' +
      '   export STRIPE_SECRET_KEY=sk_live_...',
  )
  process.exit(1)
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2026-06-24.dahlia',
  typescript: true,
})

// ── Retry configuration ──
const MAX_RETRIES = 5
const BASE_RETRY_DELAY_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** True for transient errors worth retrying: 429, 5xx, connection/timeouts. */
function isRetryableError(err: unknown): boolean {
  if (err instanceof Stripe.errors.StripeRateLimitError) return true
  if (err instanceof Stripe.errors.StripeConnectionError) return true
  if (err instanceof Stripe.errors.StripeAPIError) {
    // Retry server-side (5xx) failures; never retry client (4xx) errors.
    const status = err.statusCode
    return status === undefined || status >= 500
  }
  return false
}

/**
 * Retry an idempotent Stripe operation with exponential backoff + jitter.
 * Non-retryable errors propagate immediately; retryable errors exhaust
 * MAX_RETRIES before surfacing as a descriptive error.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      attempt += 1
      if (attempt > MAX_RETRIES || !isRetryableError(err)) {
        throw describeStripeError(err)
      }
      const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1) + Math.round(Math.random() * 250)
      console.log(`  ⏳ Rate-limited or transient error — retrying in ${delayMs}ms (attempt ${attempt}/${MAX_RETRIES})…`)
      await sleep(delayMs)
    }
  }
}

/** Turn a thrown Stripe error into an actionable message. */
function describeStripeError(err: unknown): Error {
  if (err instanceof Error) return err
  return new Error(`Unexpected Stripe error: ${String(err)}`)
}

// ── Plan configuration ──
// Prices in cents (Stripe uses smallest currency unit)
// Annual = ~10 months' worth (save ~2 months)

interface PlanConfig {
  name: string
  description: string
  monthlyPrice: number  // cents
  yearlyPrice: number   // cents
}

const PLANS: Record<string, PlanConfig> = {
  hobby: {
    name: 'Hobby',
    description: 'For early-stage SaaS with your first paying customers',
    monthlyPrice: 29_00,   // $29
    yearlyPrice: 290_00,   // $290 ($24.17/mo)
  },
  pro: {
    name: 'Pro',
    description: 'For growing B2B products that need audit trails and support',
    monthlyPrice: 99_00,   // $99
    yearlyPrice: 990_00,   // $990 ($82.50/mo)
  },
  scale: {
    name: 'Scale',
    description: 'For mid-market teams needing SSO, long retention, and priority support',
    monthlyPrice: 249_00,  // $249
    yearlyPrice: 2_490_00, // $2,490 ($207.50/mo)
  },
}

// ── Main ──

async function main(): Promise<void> {
  console.log('\n🚀 Setting up TenantScale products in Stripe...\n')

  const priceEnvVars: Record<string, string> = {}
  const successes: string[] = []
  const failures: string[] = []

  for (const [planId, config] of Object.entries(PLANS)) {
    console.log(`── ${config.name} ──`)

    try {
      // Create or update product
      let product: Stripe.Product

      // Check if product already exists (by looking for one with matching metadata)
      const existingProducts = await withRetry(() =>
        stripe.products.search({
          query: `metadata['plan_id']:'${planId}'`,
          limit: 1,
        }),
      )

      if (existingProducts.data.length > 0) {
        product = existingProducts.data[0]
        console.log(`  📦 Product exists: ${product.id} (${product.name})`)

        // Update in case description changed
        product = await withRetry(() =>
          stripe.products.update(product.id, {
            description: config.description,
          }),
        )
      } else {
        product = await withRetry(() =>
          stripe.products.create({
            name: `TenantScale ${config.name}`,
            description: config.description,
            metadata: { plan_id: planId },
          }),
        )
        console.log(`  📦 Created product: ${product.id} (${product.name})`)
      }

      // ── Monthly price ──
      const monthlyPrice = await createOrUpdatePrice(product.id, {
        nickname: `${config.name} Monthly`,
        unit_amount: config.monthlyPrice,
        currency: 'usd',
        recurring: { interval: 'month' as const },
        metadata: { plan_id: planId, interval: 'month' },
      })
      priceEnvVars[`STRIPE_PRICE_${planId.toUpperCase()}_MONTH`] = monthlyPrice.id
      console.log(`  📅 Monthly:  ${monthlyPrice.id}  ($${(config.monthlyPrice / 100).toFixed(2)}/mo)`)

      // ── Yearly price ──
      const yearlyPrice = await createOrUpdatePrice(product.id, {
        nickname: `${config.name} Yearly`,
        unit_amount: config.yearlyPrice,
        currency: 'usd',
        recurring: { interval: 'year' as const },
        metadata: { plan_id: planId, interval: 'year' },
      })
      priceEnvVars[`STRIPE_PRICE_${planId.toUpperCase()}_YEAR`] = yearlyPrice.id
      console.log(`  📅 Yearly:   ${yearlyPrice.id}  ($${(config.yearlyPrice / 100).toFixed(2)}/yr)`)

      console.log()
      successes.push(config.name)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`  ❌ ${config.name}: setup failed — ${message}`)
      console.log()
      failures.push(config.name)
    }
  }

  if (failures.length === 0) {
    // ── Output env vars ──
    console.log('═══════════════════════════════════════════')
    console.log('✅ Done! Add these to your .env file:\n')
    for (const [key, value] of Object.entries(priceEnvVars)) {
      console.log(`${key}=${value}`)
    }
    console.log('\nThen run your migration: supabase migration up')
    console.log('═══════════════════════════════════════════\n')
    return
  }

  // Partial (or total) failure — report and fail loudly so CI reacts.
  console.log('═══════════════════════════════════════════')
  console.error(`❌ Setup finished with ${failures.length} failure(s).`)
  if (successes.length > 0) {
    console.log(`   Succeeded: ${successes.join(', ')}`)
    console.log('   The following env var outputs above are still valid for successful plans.')
  }
  console.error(`   Failed:    ${failures.join(', ')}`)
  console.log('   Re-run this script after fixing the error — it is idempotent and will')
  console.log('   resume from where it left off.')
  console.log('═══════════════════════════════════════════\n')
  process.exitCode = 1
}

/**
 * Create a new price, avoiding duplicates by checking metadata.
 * If a price with matching plan_id + interval exists, reuse it.
 */
async function createOrUpdatePrice(
  productId: string,
  params: Stripe.PriceCreateParams,
): Promise<Stripe.Price> {
  const planId = params.metadata?.plan_id as string
  const interval = params.metadata?.interval as string

  // Search for existing price with same metadata
  const existingPrices = await withRetry(() =>
    stripe.prices.search({
      query: `metadata['plan_id']:'${planId}' AND metadata['interval']:'${interval}' AND active:'true'`,
      limit: 1,
    }),
  )

  if (existingPrices.data.length > 0) {
    const existing = existingPrices.data[0]
    // If amount changed, deactivate old and create new
    if (existing.unit_amount !== params.unit_amount) {
      await withRetry(() => stripe.prices.update(existing.id, { active: false }))
      return withRetry(() => stripe.prices.create({ ...params, product: productId, currency: 'usd' }))
    }
    return existing
  }

  return withRetry(() => stripe.prices.create({ ...params, product: productId, currency: 'usd' }))
}

main().catch((err) => {
  console.error('❌ Setup failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})