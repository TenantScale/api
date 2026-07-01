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
// ──────────────────────────────────────────────────────

import Stripe from 'stripe'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
if (!STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY environment variable must be set')
  process.exit(1)
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2026-06-24.dahlia',
  typescript: true,
})

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

async function main() {
  console.log('\n🚀 Setting up TenantScale products in Stripe...\n')

  const priceEnvVars: Record<string, string> = {}

  for (const [planId, config] of Object.entries(PLANS)) {
    console.log(`── ${config.name} ──`)

    // Create or update product
    let product: Stripe.Product

    // Check if product already exists (by looking for one with matching metadata)
    const existingProducts = await stripe.products.search({
      query: `metadata['plan_id']:'${planId}'`,
      limit: 1,
    })

    if (existingProducts.data.length > 0) {
      product = existingProducts.data[0]
      console.log(`  📦 Product exists: ${product.id} (${product.name})`)

      // Update in case description changed
      product = await stripe.products.update(product.id, {
        description: config.description,
      })
    } else {
      product = await stripe.products.create({
        name: `TenantScale ${config.name}`,
        description: config.description,
        metadata: { plan_id: planId },
      })
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
  }

  // ── Output env vars ──
  console.log('═══════════════════════════════════════════')
  console.log('✅ Done! Add these to your .env file:\n')
  for (const [key, value] of Object.entries(priceEnvVars)) {
    console.log(`${key}=${value}`)
  }
  console.log('\nThen run your migration: supabase migration up')
  console.log('═══════════════════════════════════════════\n')
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
  const existingPrices = await stripe.prices.search({
    query: `metadata['plan_id']:'${planId}' AND metadata['interval']:'${interval}' AND active:'true'`,
    limit: 1,
  })

  if (existingPrices.data.length > 0) {
    const existing = existingPrices.data[0]
    // If amount changed, deactivate old and create new
    if (existing.unit_amount !== params.unit_amount) {
      await stripe.prices.update(existing.id, { active: false })
      return stripe.prices.create({ ...params, product: productId, currency: 'usd' })
    }
    return existing
  }

  return stripe.prices.create({ ...params, product: productId, currency: 'usd' })
}

main().catch((err) => {
  console.error('❌ Setup failed:', err)
  process.exit(1)
})
