import { supabase } from '../db/supabase'
import { generateApiKey } from '../lib/api-key'

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
  console.log('🌱 Seeding database...')

const { error: planError } = await supabase
  .from('plans')
  .upsert(PLANS, {
    onConflict: 'id',
  })

if (planError) {
  throw planError
}

console.log('✅ Plans seeded')

  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', 'sample-tenant')
    .maybeSingle()

  let tenant = existingTenant

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
      throw error
    }

    tenant = data

    console.log('✅ Sample tenant created')
  } else {
    console.log('ℹ️ Sample tenant already exists')
  }
  if (!tenant) {
  throw new Error('Failed to create or load sample tenant')
}

 const { data: existingKey } = await supabase
  .from('api_keys')
  .select('id')
  .eq('tenant_id', tenant.id)
  .eq('label', 'Default')
  .maybeSingle()

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
    throw apiKeyError
  }

  console.log('✅ Sample API key created')
  console.log(`API Key: ${rawKey}`)
} else {
  console.log('ℹ️ Default API key already exists')
}

console.log('\n🎉 Database seeded successfully!\n')
console.log(`Tenant: ${tenant.name}`)
console.log(`Slug: ${tenant.slug}`)
}
main().catch((err) => {
  console.error(err)
  process.exit(1)
})