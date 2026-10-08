// ──────────────────────────────────────────────────────
// Database Seed Script
// ──────────────────────────────────────────────────────
// Populates a dev/test database with starter data:
//   - Plan tiers: Free, Hobby, Pro (with feature flags)
//   - A sample tenant
//   - A sample API key for that tenant
//
// Idempotent: re-running is safe — existing rows are matched by
// natural key (plan `id`, tenant `slug`, api key `label` + tenant)
// and reused instead of duplicated.
//
// Usage:
//   pnpm seed
//   # or: tsx src/scripts/seed.ts
// ──────────────────────────────────────────────────────
import 'dotenv/config'
import { supabase } from '../db/supabase.js'
import { generateApiKey } from '../lib/api-key.js'

// ── Validate required environment ──
const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((v) => !process.env[v])
if (missing.length > 0) {
  console.error(
    '❌ Missing required environment variables for seeding: ' +
      missing.join(', ') +
      '.\n   Add them to your .env file or export them before running.',
  )
  process.exit(1)
}

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    description: 'For side projects and prototypes — build your entire MVP at no cost',
    price_monthly: 0,
    features: {
      audit_log_retention_days: 7,
      sso: false,
      custom_domain: false,
      team_members: 2,
      webhooks: false,
      api_access: true,
      admin_dashboard: true,
    },
    max_users: 2,
    max_tenants: 3,
    api_calls_per_day: 1000,
    sort_order: 1,
  },
  {
    id: 'hobby',
    name: 'Hobby',
    description: 'For early-stage SaaS with your first paying customers',
    price_monthly: 2900,
    features: {
      audit_log_retention_days: 30,
      sso: false,
      custom_domain: false,
      team_members: 10,
      webhooks: true,
      api_access: true,
      admin_dashboard: true,
    },
    max_users: 10,
    max_tenants: 15,
    api_calls_per_day: 10000,
    sort_order: 2,
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For growing B2B products that need audit trails and support',
    price_monthly: 9900,
    features: {
      audit_log_retention_days: 90,
      sso: false,
      custom_domain: false,
      team_members: 100,
      webhooks: true,
      api_access: true,
      admin_dashboard: true,
    },
    max_users: 100,
    max_tenants: 100,
    api_calls_per_day: 100000,
    sort_order: 3,
  },
]

async function main() {
  console.log('🌱 Seeding database...\n')

  // ── Plans ──
  const { error: planError } = await supabase
    .from('plans')
    .upsert(PLANS, { onConflict: 'id' })
  if (planError) {
    throw new Error(`Failed to seed plans: ${planError.message}`)
  }
  console.log(`✅ Plans seeded (${PLANS.length}: Free, Hobby, Pro)`)

  // ── Sample tenant ──
  const existingTenant = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', 'sample-tenant')
    .maybeSingle()

  if (existingTenant.error) {
    throw new Error(`Failed to look up sample tenant: ${existingTenant.error.message}`)
  }

  let tenant = existingTenant.data

  if (!tenant) {
    const { data, error } = await supabase
      .from('tenants')
      .insert({
        name: 'Sample Tenant',
        slug: 'sample-tenant',
        plan_id: 'free',
      })
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to create sample tenant: ${error.message}`)
    }
    if (!data) {
      throw new Error('Failed to create sample tenant: no row returned')
    }

    tenant = data
    console.log('✅ Sample tenant created')
  } else {
    console.log('ℹ️ Sample tenant already exists')
  }

  // ── Sample API key ──
  const { data: existingKey, error: existingKeyError } = await supabase
    .from('api_keys')
    .select('id, key_prefix')
    .eq('tenant_id', tenant.id)
    .eq('label', 'Default')
    .maybeSingle()

  if (existingKeyError) {
    throw new Error(`Failed to look up sample API key: ${existingKeyError.message}`)
  }

  if (!existingKey) {
    const { rawKey, keyHash, keyPrefix } = generateApiKey()

    const { error: apiKeyError } = await supabase
      .from('api_keys')
      .insert({
        tenant_id: tenant.id,
        label: 'Default',
        key_hash: keyHash,
        key_prefix: keyPrefix,
        scopes: ['read', 'write'],
      })

    if (apiKeyError) {
      throw new Error(`Failed to create sample API key: ${apiKeyError.message}`)
    }

    console.log('✅ Sample API key created')
    console.log(`🔑 API Key: ${rawKey}`)
    console.log(`   (store it now — it is only shown once)`)
  } else {
    console.log('ℹ️ Default API key already exists')
  }

  console.log('\n🎉 Database seeded successfully!')
  console.log(`Tenant: ${tenant.name} (slug: ${tenant.slug})`)
  console.log(`Plan:   ${tenant.plan_id ?? 'free'}`)
}

main().catch((err) => {
  console.error('❌ Seeding failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})