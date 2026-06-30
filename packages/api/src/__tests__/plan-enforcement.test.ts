// ──────────────────────────────────────────────────────
// Plan Enforcement — Isolation Tests
// Verifies the middleware rejects requests that exceed
// plan limits or use disabled features, and passes
// requests within plan allowances.
// ──────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// ── Mock Supabase ──
// We need different query builders per table because
// the plan-store calls supabase.from('tenants') and
// supabase.from('plans') with different expectations.
const mockSupabase = {
  from: vi.fn(),
}
vi.mock('../db/supabase', () => ({ supabase: mockSupabase }))

// ── Factory for chainable query builders ──
function chainQB() {
  const qb: Record<string, unknown> = {}
  qb.select = vi.fn().mockReturnThis()
  qb.insert = vi.fn().mockReturnThis()
  qb.update = vi.fn().mockReturnThis()
  qb.delete = vi.fn().mockReturnThis()
  qb.eq = vi.fn().mockReturnThis()
  qb.order = vi.fn().mockReturnThis()
  qb.limit = vi.fn().mockReturnThis()
  qb.range = vi.fn().mockReturnThis()
  qb.single = vi.fn()
  qb.maybeSingle = vi.fn()
  qb.or = vi.fn().mockReturnThis()
  // Support fire-and-forget .then() chaining (auth middleware's last_used_at update)
  qb.then = vi.fn().mockResolvedValue(undefined)
  return qb as unknown as {
    select: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    range: ReturnType<typeof vi.fn>
    or: ReturnType<typeof vi.fn>
    then: ReturnType<typeof vi.fn>
  }
}

// ── Shared plan data ──
const FREE_PLAN = {
  id: 'free',
  name: 'Free',
  description: 'Free tier',
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
  created_at: '2026-01-01T00:00:00Z',
}

const PRO_PLAN = {
  id: 'pro',
  name: 'Pro',
  description: 'Pro tier',
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
  created_at: '2026-01-01T00:00:00Z',
}

// ════════════════════════════════════════════════════════════════
// requirePlanFeature tests
// ════════════════════════════════════════════════════════════════

describe('requirePlanFeature(webhooks)', () => {
  let app: Hono
  let tenantsQB: ReturnType<typeof chainQB>
  let plansQB: ReturnType<typeof chainQB>
  let keysQB: ReturnType<typeof chainQB>

  beforeEach(async () => {
    vi.clearAllMocks()
    tenantsQB = chainQB()
    plansQB = chainQB()
    keysQB = chainQB()

    // Route supabase.from per table
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'tenants') return tenantsQB
      if (table === 'plans') return plansQB
      if (table === 'api_keys') return keysQB
      // webhooks table — use a new chain QB for each call
      const whQB = chainQB()
      whQB.single.mockResolvedValue({
        data: { id: 'wh1', url: 'https://example.com/hooks', events: ['tenant.created'], description: 'Test', is_active: true, secret: 'ts_whsec_test', created_at: '2026-01-01T00:00:00Z' },
        error: null,
      })
      return whQB
    })

    const { webhookRoutes } = await import('../routes/webhooks')
    app = new Hono().basePath('/v1').route('/', webhookRoutes)
  })

  it('allows webhook creation when plan has webhooks: true (Pro tier)', async () => {
    // API key lookup succeeds — must include the nested tenant join
    // that requireApiKey middleware checks
    keysQB.single.mockResolvedValue({
      data: {
        id: 'key-1',
        tenant_id: 'tenant-pro-1',
        tenant: { id: 'tenant-pro-1', is_active: true },
        key_hash: 'abc',
        key_prefix: 'tk_pro',
        scopes: ['admin'],
        is_active: true,
        created_by: 'user-1',
      },
      error: null,
    })

    // Tenant lookup for plan-store
    tenantsQB.single.mockResolvedValue({
      data: { id: 'tenant-pro-1', plan_id: 'pro' },
      error: null,
    })

    // Plan lookup for plan-store
    plansQB.single.mockResolvedValue({
      data: PRO_PLAN,
      error: null,
    })

    const res = await app.request('/v1/admin/tenants/tenant-pro-1/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tk_pro_valid_key',
      },
      body: JSON.stringify({
        url: 'https://example.com/hooks',
        events: ['tenant.created'],
        description: 'Test',
      }),
    })

    // Should succeed — Pro plan has webhooks: true
    expect(res.status).toBe(201)
  })

  it('blocks webhook creation when plan has webhooks: false (Free tier)', async () => {
    // API key lookup succeeds — must include the nested tenant join
    keysQB.single.mockResolvedValue({
      data: {
        id: 'key-2',
        tenant_id: 'tenant-free-1',
        tenant: { id: 'tenant-free-1', is_active: true },
        key_hash: 'def',
        key_prefix: 'tk_free',
        scopes: ['admin'],
        is_active: true,
        created_by: 'user-2',
      },
      error: null,
    })

    // Tenant lookup for plan-store — Free tier
    tenantsQB.single.mockResolvedValue({
      data: { id: 'tenant-free-1', plan_id: 'free' },
      error: null,
    })

    // Plan lookup — Free plan
    plansQB.single.mockResolvedValue({
      data: FREE_PLAN,
      error: null,
    })

    const res = await app.request('/v1/admin/tenants/tenant-free-1/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tk_free_valid_key',
      },
      body: JSON.stringify({
        url: 'https://example.com/hooks',
        events: ['tenant.created'],
        description: 'Test',
      }),
    })

    // Should be blocked — Free plan has webhooks: false
    expect(res.status).toBe(403)

    const body = await res.json() as Record<string, unknown>
    expect(body.code).toBe('PLAN_LIMIT_REACHED')
    expect(body.feature).toBe('webhooks')
  })

  it('returns 401 when no API key provided (before plan check)', async () => {
    const res = await app.request('/v1/admin/tenants/tenant-pro-1/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/hooks',
        events: ['tenant.created'],
      }),
    })

    expect(res.status).toBe(401)
  })
})

// ════════════════════════════════════════════════════════════════
// requirePlanLimit (max_tenants) tests
// ════════════════════════════════════════════════════════════════

describe('requirePlanLimit', () => {
  it('getPlanLimit returns correct value from plan data', async () => {
    const { getPlanLimit } = await import('../lib/plan-store')

    const tenantsQB_local = chainQB()
    const plansQB_local = chainQB()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'tenants') return tenantsQB_local
      if (table === 'plans') return plansQB_local
      return chainQB()
    })

    tenantsQB_local.single.mockResolvedValue({
      data: { id: 'tenant-1', plan_id: 'free' },
      error: null,
    })
    plansQB_local.single.mockResolvedValue({
      data: FREE_PLAN,
      error: null,
    })

    const limit = await getPlanLimit('tenant-1', 'max_tenants')
    expect(limit).toBe(3) // Free gets 3 tenants
  })

  it('getPlanLimit returns null for Enterprise (unlimited)', async () => {
    const { getPlanLimit } = await import('../lib/plan-store')

    const tenantsQB_local = chainQB()
    const plansQB_local = chainQB()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'tenants') return tenantsQB_local
      if (table === 'plans') return plansQB_local
      return chainQB()
    })

    tenantsQB_local.single.mockResolvedValue({
      data: { id: 'tenant-ent', plan_id: 'enterprise' },
      error: null,
    })
    plansQB_local.single.mockResolvedValue({
      data: {
        id: 'enterprise',
        name: 'Enterprise',
        price_monthly: 0,
        features: {
          audit_log_retention_days: 3650,
          sso: true,
          custom_domain: true,
          team_members: null,
          webhooks: true,
          api_access: true,
          admin_dashboard: true,
        },
        max_users: null,
        max_tenants: null,
        api_calls_per_day: null,
        sort_order: 5,
      },
      error: null,
    })

    const limit = await getPlanLimit('tenant-ent', 'max_tenants')
    expect(limit).toBeNull() // Enterprise = unlimited
  })

  it('hasPlanFeature returns false for disabled feature', async () => {
    const { hasPlanFeature } = await import('../lib/plan-store')

    const tenantsQB_local = chainQB()
    const plansQB_local = chainQB()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'tenants') return tenantsQB_local
      if (table === 'plans') return plansQB_local
      return chainQB()
    })

    tenantsQB_local.single.mockResolvedValue({
      data: { id: 'tenant-free-1', plan_id: 'free' },
      error: null,
    })
    plansQB_local.single.mockResolvedValue({
      data: FREE_PLAN,
      error: null,
    })

    const enabled = await hasPlanFeature('tenant-free-1', 'webhooks')
    expect(enabled).toBe(false)
  })

  it('hasPlanFeature returns true for enabled feature', async () => {
    const { hasPlanFeature } = await import('../lib/plan-store')

    const tenantsQB_local = chainQB()
    const plansQB_local = chainQB()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'tenants') return tenantsQB_local
      if (table === 'plans') return plansQB_local
      return chainQB()
    })

    tenantsQB_local.single.mockResolvedValue({
      data: { id: 'tenant-pro-1', plan_id: 'pro' },
      error: null,
    })
    plansQB_local.single.mockResolvedValue({
      data: PRO_PLAN,
      error: null,
    })

    const enabled = await hasPlanFeature('tenant-pro-1', 'webhooks')
    expect(enabled).toBe(true)
  })

  it('returns null for missing plan (fail closed)', async () => {
    const { getPlanForTenant } = await import('../lib/plan-store')

    const tenantsQB_local = chainQB()
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'tenants') return tenantsQB_local
      return chainQB()
    })

    tenantsQB_local.single.mockResolvedValue({
      data: null,
      error: new Error('Not found'),
    })

    const plan = await getPlanForTenant('nonexistent-tenant')
    expect(plan).toBeNull()
  })
})
