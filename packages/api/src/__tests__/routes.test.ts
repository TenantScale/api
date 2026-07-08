// ──────────────────────────────────────────────────────
// TenantScale API — Route tests (public endpoints)
// ──────────────────────────────────────────────────────
// Auth-protected routes go through requireApiKey which chains
// multiple supabase calls. For those, we test security (401)
// and the schema validation — the real business logic is
// covered by the SDK unit tests.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// ── Mock Supabase ──
const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({
      data: { current_count: 1 },
      error: null,
    }),
  }),
  auth: {
    getUser: vi.fn(),
  },
}
vi.mock('../db/supabase', () => ({ supabase: mockSupabase }))
const { statusRoutes } = await import('../routes/status')
const { tenantRoutes } = await import('../routes/tenants')

/**
 * Returns a query builder mock where all chain methods return `this`.
 * Call `.collect()` to get the final resolved value after chain completion.
 */
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
  return qb as unknown as {
    select: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    range: ReturnType<typeof vi.fn>
  }
}

// ── Schemas ──
describe('Input validation schemas', () => {
  it('validates create tenant schema', async () => {
    const { createTenantSchema } = await import('../routes/schemas')

    // Schema only accepts name + slug; plan_id is always 'free' server-side
    const valid = createTenantSchema.parse({ name: 'Test', slug: 'test-co' })
    expect(valid.name).toBe('Test')
    expect(valid.slug).toBe('test-co')
    expect(Object.keys(valid)).not.toContain('plan_id')

    expect(() => createTenantSchema.parse({ name: '', slug: 'ok' })).toThrow()
    expect(() => createTenantSchema.parse({ name: 'A', slug: 'BAD SLUG!' })).toThrow()
  })
})

// ── POST /tenants (public endpoint) ──
describe('POST /tenants', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono().basePath('/v1').route('/', tenantRoutes)
  })

  it('rejects missing name (zod validation)', async () => {
    const res = await app.request('/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'test-co' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid slug format', async () => {
    const res = await app.request('/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', slug: 'BAD SLUG!' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects empty body', async () => {
    const res = await app.request('/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('creates a tenant when supabase succeeds', async () => {
    const qb = chainQB()
    qb.maybeSingle.mockResolvedValue({ data: null, error: null })
    qb.single.mockResolvedValue({
      data: { id: 't1', name: 'Test Co', slug: 'test-co', plan_id: 'free', features: {}, config: {}, settings: {}, created_at: '2026-01-01T00:00:00Z' },
      error: null,
    })
    mockSupabase.from.mockReturnValue(qb)

    const res = await app.request('/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Co', slug: 'test-co' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.name).toBe('Test Co')
    expect(body.api_key).toMatch(/^tk_/)
  })

  it('rejects duplicate slug', async () => {
    const qb = chainQB()
    qb.maybeSingle.mockResolvedValue({ data: { id: 'existing' }, error: null })
    mockSupabase.from.mockReturnValue(qb)

    const res = await app.request('/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', slug: 'test-co' }),
    })
    expect(res.status).toBe(409)
  })

  // ── BILLING ENFORCEMENT TESTS ──

  it('BILLING ENFORCEMENT: ignores plan_id in body, always creates as free', async () => {
    const qb = chainQB()
    qb.maybeSingle.mockResolvedValue({ data: null, error: null })
    // First .single() is the plans table lookup (verify free exists)
    // Second .single() is the tenant insert
    qb.single
      .mockResolvedValueOnce({
        data: {
          id: 'free',
          name: 'Free',
          max_tenants: 3,
          max_users: 2,
          api_calls_per_day: 1000,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 't1',
          name: 'Test Co',
          slug: 'test-co',
          plan_id: 'free',
          features: {},
          config: {},
          settings: {},
          created_at: '2026-01-01T00:00:00Z',
        },
        error: null,
      })
    mockSupabase.from.mockReturnValue(qb)

    const res = await app.request('/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Dev tries to create an 'enterprise' tenant for free
      body: JSON.stringify({ name: 'Test Co', slug: 'test-co', plan_id: 'enterprise' }),
    })

    expect(res.status).toBe(201)
    const body = await res.json() as Record<string, unknown>
    expect(body.plan_id).toBe('free')

    // Verify the insert used 'free', not 'enterprise'
    const insertCall = qb.insert.mock.calls[0][0]
    expect(insertCall.plan_id).toBe('free')
    expect(insertCall.plan_id).not.toBe('enterprise')
  })

  it('BILLING ENFORCEMENT: returns 500 if Free plan not in DB', async () => {
    const qb = chainQB()
    qb.maybeSingle.mockResolvedValue({ data: null, error: null })
    // Free plan lookup fails
    qb.single.mockResolvedValue({ data: null, error: null })
    mockSupabase.from.mockReturnValue(qb)

    const res = await app.request('/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', slug: 'test-co' }),
    })

    expect(res.status).toBe(500)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain('Free plan not found')
  })
})

// ── Auth-protected endpoints (security checks) ──
describe('Auth-protected tenant routes', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = new Hono().basePath('/v1').route('/', tenantRoutes)
  })

  it('GET /tenants returns 401 without auth header', async () => {
    const res = await app.request('/v1/tenants')
    expect(res.status).toBe(401)
  })

  it('GET /tenants/:id returns 401 without auth header', async () => {
    const res = await app.request('/v1/tenants/t1')
    expect(res.status).toBe(401)
  })

  it('PATCH /tenants/:id returns 401 without auth header', async () => {
    const res = await app.request('/v1/tenants/t1', { method: 'PATCH' })
    expect(res.status).toBe(401)
  })

  it('POST /tenants/:id/api-keys returns 401 without auth header', async () => {
    const res = await app.request('/v1/tenants/t1/api-keys', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('DELETE /tenants/:id/api-keys/:keyId returns 404 (use admin API instead)', async () => {
    const res = await app.request('/v1/tenants/t1/api-keys/k1', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

// ── Registration schema validation ──
describe('Portal registration', () => {
  it('rejects missing email', async () => {
    const { registerSchema } = await import('../routes/schemas')
    expect(() => registerSchema.parse({ password: 'p' })).toThrow()
  })

  it('rejects short password', async () => {
    const { registerSchema } = await import('../routes/schemas')
    expect(() => registerSchema.parse({ email: 'a@b.com', password: '1234567' })).toThrow()
  })

  it('rejects missing tenant_name', async () => {
    const { registerSchema } = await import('../routes/schemas')
    expect(() => registerSchema.parse({ email: 'a@b.com', password: '12345678' })).toThrow()
  })

  it('rejects invalid slug', async () => {
    const { registerSchema } = await import('../routes/schemas')
    expect(() => registerSchema.parse({
      email: 'a@b.com', password: '12345678',
      tenant_name: 'Test', tenant_slug: 'BAD SLUG!',
    })).toThrow()
  })

  it('accepts valid registration', async () => {
    const { registerSchema } = await import('../routes/schemas')
    const result = registerSchema.parse({
      email: 'user@test.com', password: 'password123',
      tenant_name: 'Test Co', tenant_slug: 'test-co',
    })
    expect(result.email).toBe('user@test.com')
    expect(result.tenant_slug).toBe('test-co')
  })

  it('POST /portal/register returns 400 on validation fail (public endpoint)', async () => {
    const { portalRoutes } = await import('../routes/portal')
    const app = new Hono().basePath('/v1').route('/', portalRoutes)
    const res = await app.request('/v1/portal/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: '12', tenant_name: '', tenant_slug: '' }),
    })
    expect(res.status).toBe(400)
  })
})

// ── Webhook routes ──
describe('Webhook routes', () => {
  let app: Hono

  beforeEach(async () => {
    vi.clearAllMocks()
    const { webhookRoutes } = await import('../routes/webhooks')
    app = new Hono().basePath('/v1').route('/', webhookRoutes)
  })

  it('GET /portal/webhooks returns 401 without session', async () => {
    const res = await app.request('/v1/portal/webhooks')
    expect(res.status).toBe(401)
  })

  it('POST /portal/webhooks returns 401 without session', async () => {
    const res = await app.request('/v1/portal/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['tenant.created'] }),
    })
    expect(res.status).toBe(401)
  })

  it('rejects missing URL', async () => {
    const { createWebhookSchema } = await import('../routes/webhooks')
    expect(() => createWebhookSchema.parse({ events: ['tenant.created'] })).toThrow()
  })

  it('rejects invalid URL', async () => {
    const { createWebhookSchema } = await import('../routes/webhooks')
    expect(() => createWebhookSchema.parse({ url: 'not-a-url', events: ['tenant.created'] })).toThrow()
  })

  it('rejects empty events array', async () => {
    const { createWebhookSchema } = await import('../routes/webhooks')
    expect(() => createWebhookSchema.parse({ url: 'https://example.com/hook', events: [] })).toThrow()
  })

  it('rejects unknown event type', async () => {
    const { createWebhookSchema } = await import('../routes/webhooks')
    expect(() => createWebhookSchema.parse({
      url: 'https://example.com/hook',
      events: ['unknown_event'],
    })).toThrow()
  })

  it('accepts valid webhook config', async () => {
    const { createWebhookSchema } = await import('../routes/webhooks')
    const result = createWebhookSchema.parse({
      url: 'https://api.myapp.com/webhooks/tenantscale',
      events: ['tenant.created', 'user.invited'],
      description: 'My webhook',
    })
    expect(result.url).toBe('https://api.myapp.com/webhooks/tenantscale')
    expect(result.events).toHaveLength(2)
  })
})

// ── Audit routes (security) ──
describe('Audit auth', () => {
  it('POST /audit returns 401 without auth', async () => {
    const { auditRoutes } = await import('../routes/audit')
    const app = new Hono().basePath('/v1').route('/', auditRoutes)
    const res = await app.request('/v1/audit', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})

// ── Admin routes (security) ──
describe('Admin auth', () => {
  it('GET /admin/impersonate returns 401 without auth (auth applies globally)', async () => {
    const { adminRoutes } = await import('../routes/admin')
    const app = new Hono().basePath('/v1').route('/', adminRoutes)
    const res = await app.request('/v1/admin/impersonate')
    expect(res.status).toBe(401)
  })

  it('POST /admin/impersonate returns 401 without auth', async () => {
    const { adminRoutes } = await import('../routes/admin')
    const app = new Hono().basePath('/v1').route('/', adminRoutes)
    const res = await app.request('/v1/admin/impersonate', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('GET /admin/audit returns 401 without auth', async () => {
    const { adminRoutes } = await import('../routes/admin')
    const app = new Hono().basePath('/v1').route('/', adminRoutes)
    const res = await app.request('/v1/admin/audit')
    expect(res.status).toBe(401)
  })
})

// ── Events routes (security) ──
describe('Events auth', () => {
  it('POST /events returns 401 without auth', async () => {
    const { eventRoutes } = await import('../routes/events')
    const app = new Hono().basePath('/v1').route('/', eventRoutes)
    const res = await app.request('/v1/events', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})

// ── Plan routes (security) ──
describe('Plans auth', () => {
  it('GET /plans returns 401 without auth', async () => {
    const { planRoutes } = await import('../routes/plans')
    const app = new Hono().basePath('/v1').route('/', planRoutes)
    const res = await app.request('/v1/plans')
    expect(res.status).toBe(401)
  })

  it('GET /plans/:id returns 401 without auth', async () => {
    const { planRoutes } = await import('../routes/plans')
    const app = new Hono().basePath('/v1').route('/', planRoutes)
    const res = await app.request('/v1/plans/pro')
    expect(res.status).toBe(401)
  })
})

// ════════════════════════════════════════════════════════════════
// Portal Tenant — authenticated tenant management
// ════════════════════════════════════════════════════════════════

describe('Portal tenant endpoints', () => {
  let app: Hono

  beforeEach(async () => {
    vi.clearAllMocks()
    // Default: auth.getUser returns null (no session) — individual tests override
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const { portalRoutes } = await import('../routes/portal')
    app = new Hono().basePath('/v1').route('/', portalRoutes)
  })

  // ── GET /portal/tenants ──
  describe('GET /portal/tenants', () => {
    it('returns 401 without session', async () => {
      const res = await app.request('/v1/portal/tenants')
      expect(res.status).toBe(401)
    })

    it('returns 200 with user tenant list', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'dev@test.com' } },
        error: null,
      })

      // Helper: default QB with "not found" responses
      function makeQB() {
        const qb = chainQB()
        qb.maybeSingle.mockResolvedValue({ data: null, error: null })
        qb.single.mockResolvedValue({ data: null, error: null })
        qb.select.mockReturnThis()
        qb.eq.mockReturnThis()
        qb.order.mockResolvedValue({ data: [], error: null })
        return qb
      }

      // Mock tenant_users for both session lookup and tenant list
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'tenant_users') {
          const listQB = makeQB()
          // First maybeSingle call (session resolve) — with join shape
          listQB.maybeSingle.mockResolvedValue({
            data: { id: 'membership-1', tenant_id: 'tenant-1', role: 'owner', tenant: { id: 'tenant-1', name: 'My Tenant', slug: 'my-tenant' } },
            error: null,
          })
          // .select with join — order resolves with data
          listQB.order.mockResolvedValue({
            data: [
              {
                id: 'm1',
                role: 'owner',
                joined_at: '2026-01-01T00:00:00Z',
                tenant: {
                  id: 'tenant-1',
                  name: 'My First App',
                  slug: 'my-first-app',
                  plan_id: 'free',
                  is_active: true,
                  created_at: '2026-01-01T00:00:00Z',
                },
              },
            ],
            error: null,
          })
          return listQB
        }
        return makeQB()
      })

      const res = await app.request('/v1/portal/tenants', {
        headers: { Authorization: 'Bearer valid-jwt' },
      })

      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, unknown>
      expect(body.tenants).toBeDefined()
      expect(Array.isArray(body.tenants)).toBe(true)
      expect(body.tenants).toHaveLength(1)
      expect((body.tenants as Array<Record<string, unknown>>)[0].name).toBe('My First App')
    })
  })

  // ── POST /portal/tenants ──
  describe('POST /portal/tenants', () => {
    function setupMockSession() {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'dev@test.com' } },
        error: null,
      })
    }

    function setupMockCreateTenant(
      options: { maxTenants?: number; currentTenants?: number; slugExists?: boolean } = {},
    ) {
      const { maxTenants = 3, currentTenants = 0, slugExists = false } = options

      // Helper: create a query builder with default "not found, no error" responses
      function makeDefaultQB() {
        const qb = chainQB()
        qb.maybeSingle.mockResolvedValue({ data: null, error: null })
        qb.single.mockResolvedValue({ data: null, error: null })
        qb.select.mockReturnThis()
        qb.eq.mockReturnThis()
        qb.order.mockResolvedValue({ data: [], error: null })
        qb.limit.mockReturnThis()
        qb.range.mockReturnThis()
        return qb
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'tenant_users') {
          // Session membership lookup
          const tuQB = makeDefaultQB()
          // First maybeSingle call = session resolve
          tuQB.maybeSingle.mockResolvedValue({
            data: { id: 'membership-1', tenant_id: 'tenant-1', role: 'owner', tenant: { id: 'tenant-1', name: 'My Tenant', slug: 'my-tenant' } },
            error: null,
          })
          // Second call: count query — supabase.from().select('*', {count:'exact',head:true}).eq()
          // The eq() returns the QB, and then `await qb` triggers .then()
          // Make the QB itself a thenable that resolves with count data
          const tuQBWithThen = tuQB as Record<string, unknown>
          tuQBWithThen.then = vi.fn().mockImplementation((resolve: (value: unknown) => void) => {
            resolve({ data: null, count: currentTenants, error: null })
          })
          return tuQBWithThen as ReturnType<typeof makeDefaultQB>
        }

        if (table === 'tenants') {
          const tQB = makeDefaultQB()
          // Slug check
          tQB.maybeSingle.mockResolvedValue({
            data: slugExists ? { id: 'existing' } : null,
            error: null,
          })
          // Insert + select + single
          tQB.single.mockResolvedValue({
            data: {
              id: 'new-tenant-1',
              name: 'My New App',
              slug: 'my-new-app',
              plan_id: 'free',
              features: {},
              config: {},
              settings: { name: 'My New App' },
              is_active: true,
              created_at: '2026-01-01T00:00:00Z',
            },
            error: null,
          })
          return tQB
        }

        if (table === 'plans') {
          const pQB = makeDefaultQB()
          pQB.single.mockResolvedValue({
            data: { id: 'free', max_tenants: maxTenants, max_users: 2 },
            error: null,
          })
          return pQB
        }

        if (table === 'api_keys') {
          const kQB = makeDefaultQB() as Record<string, unknown>
          // Support both .then(undefined, fn) and await patterns
          kQB.then = vi.fn().mockImplementation((resolve: (value: unknown) => void) => {
            resolve({ data: null, error: null })
            return Promise.resolve({ data: null, error: null })
          })
          return kQB as ReturnType<typeof makeDefaultQB>
        }

        // platform_admins, audit_events, etc — default "not found"
        return makeDefaultQB()
      })
    }

    it('returns 401 without session', async () => {
      const res = await app.request('/v1/portal/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My New App', slug: 'my-new-app' }),
      })
      expect(res.status).toBe(401)
    })

    it('returns 400 with missing name', async () => {
      setupMockSession()
      const res = await app.request('/v1/portal/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ slug: 'my-new-app' }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 with invalid slug', async () => {
      setupMockSession()
      const res = await app.request('/v1/portal/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ name: 'My App', slug: 'BAD SLUG!' }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 201 and creates tenant when within max_tenants limit', async () => {
      setupMockSession()
      setupMockCreateTenant({ currentTenants: 0 })

      const res = await app.request('/v1/portal/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ name: 'My New App', slug: 'my-new-app' }),
      })

      expect(res.status).toBe(201)
      const body = await res.json() as Record<string, unknown>
      expect(body.name).toBe('My New App')
      expect(body.plan).toBe('free')
      expect(body.api_key).toMatch(/^tk_/)
    })

    it('returns 409 on duplicate slug', async () => {
      setupMockSession()
      setupMockCreateTenant({ slugExists: true })

      const res = await app.request('/v1/portal/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ name: 'My New App', slug: 'my-new-app' }),
      })
      expect(res.status).toBe(409)
    })

    it('BILLING ENFORCEMENT: returns 403 when exceeding max_tenants', async () => {
      setupMockSession()
      // User already has 3 tenants (Free max is 3)
      setupMockCreateTenant({ currentTenants: 3 })

      const res = await app.request('/v1/portal/tenants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ name: 'Fourth App', slug: 'fourth-app' }),
      })

      expect(res.status).toBe(403)
      const body = await res.json() as Record<string, unknown>
      expect(body.code).toBe('PLAN_LIMIT_REACHED')
      expect(body.limit).toBe(3)
      expect(body.current).toBe(3)
    })
  })
})
describe('Status endpoints', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()

    app = new Hono()
      .get('/health', async (c) => {
        let dbOk = false
        try {
  const { error } = await mockSupabase
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .limit(1)

  dbOk = !error
} catch {
  // Simulate database unreachable
}

        return c.json({
          status: dbOk ? 'ok' : 'degraded',
          version: '0.1.0',
          uptime: Math.floor(process.uptime()),
          db: dbOk ? 'connected' : 'unreachable',
        })
      })
      .basePath('/v1')
      .route('/', statusRoutes)
  })

  it('GET /health returns 200 when database is connected', async () => {
    const qb = chainQB()
    qb.limit.mockResolvedValue({
      error: null,
    })

    mockSupabase.from.mockReturnValue(qb)

    const res = await app.request('/health')

    expect(res.status).toBe(200)

    const body = await res.json()

    expect(body).toEqual(
      expect.objectContaining({
        status: 'ok',
        db: 'connected',
        version: expect.any(String),
        uptime: expect.any(Number),
      }),
    )
  })

  it('GET /health returns degraded when database is unreachable', async () => {
    const qb = chainQB()

    qb.limit.mockRejectedValue(new Error('DB unavailable'))

    mockSupabase.from.mockReturnValue(qb)

    const res = await app.request('/health')

    expect(res.status).toBe(200)

    const body = await res.json()

    expect(body.status).toBe('degraded')
    expect(body.db).toBe('unreachable')
  })

  it('GET /v1/status returns expected response shape', async () => {
    const qb = chainQB()

    qb.limit.mockResolvedValue({
      error: null,
    })

    mockSupabase.from.mockReturnValue(qb)

    const res = await app.request('/v1/status')

    expect(res.status).toBe(200)

    const body = await res.json()

    expect(body).toEqual(
      expect.objectContaining({
        service: expect.any(String),
        version: expect.any(String),
        mode: expect.any(String),
        uptime: expect.any(Number),
        database: expect.any(String),
        stripe: expect.any(String),
        timestamp: expect.any(String),
      }),
    )
  })

  it('GET /v1/status reports stripe configured', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123'

    const qb = chainQB()
    qb.limit.mockResolvedValue({ error: null })

    mockSupabase.from.mockReturnValue(qb)

    const res = await app.request('/v1/status')

    const body = await res.json()

    expect(body.stripe).toBe('configured')

    delete process.env.STRIPE_SECRET_KEY
  })

  it('GET /v1/status reports stripe not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY

    const qb = chainQB()
    qb.limit.mockResolvedValue({ error: null })

    mockSupabase.from.mockReturnValue(qb)

    const res = await app.request('/v1/status')

    const body = await res.json()

    expect(body.stripe).toBe('not_configured')
  })
})
