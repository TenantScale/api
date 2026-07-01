// ──────────────────────────────────────────────────────
// TenantScale API — Session auth middleware tests
// ──────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// ── Mock Supabase ──
const mockSupabase = {
  from: vi.fn(),
  auth: {
    getUser: vi.fn(),
  },
}
vi.mock('../db/supabase', () => ({ supabase: mockSupabase }))

const { requirePortalSession, requirePortalRole, requireSuperAdmin } = await import('../middleware/session-auth')

/**
 * Returns a query builder mock where all chain methods return `this`.
 */
function chainQB() {
  const qb: Record<string, unknown> = {}
  qb.select = vi.fn().mockReturnThis()
  qb.eq = vi.fn().mockReturnThis()
  qb.order = vi.fn().mockReturnThis()
  qb.limit = vi.fn().mockReturnThis()
  qb.range = vi.fn().mockReturnThis()
  qb.single = vi.fn()
  qb.maybeSingle = vi.fn()
  return qb as unknown as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
    maybeSingle: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    range: ReturnType<typeof vi.fn>
  }
}

describe('requirePortalSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when no Authorization header', async () => {
    const app = new Hono()
    app.use('*', requirePortalSession)
    app.get('/test', (c) => c.json((c.var as any).portalSession))

    const res = await app.request('/test')
    expect(res.status).toBe(401)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe('Missing or invalid Authorization header')
  })

  it('returns 401 when Authorization is not Bearer', async () => {
    const app = new Hono()
    app.use('*', requirePortalSession)
    app.get('/test', (c) => c.json((c.var as any).portalSession))

    const res = await app.request('/test', {
      headers: { Authorization: 'Basic dGVzdDp0ZXN0' },
    })
    expect(res.status).toBe(401)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe('Missing or invalid Authorization header')
  })

  it('returns 401 with invalid JWT (supabase.auth.getUser returns no user)', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    })

    const app = new Hono()
    app.use('*', requirePortalSession)
    app.get('/test', (c) => c.json((c.var as any).portalSession))

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer invalid-jwt' },
    })
    expect(res.status).toBe(401)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe('Invalid or expired session')
  })

  it('returns 401 with invalid JWT (auth error)', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error('Token expired'),
    })

    const app = new Hono()
    app.use('*', requirePortalSession)
    app.get('/test', (c) => c.json((c.var as any).portalSession))

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer expired-jwt' },
    })
    expect(res.status).toBe(401)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe('Invalid or expired session')
  })

  it('sets portalSession with tenant context for normal tenant user', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })

    const qb = chainQB()
    // First maybeSingle call: platform_admins -> not an admin
    // Second maybeSingle call: tenant_users -> found membership
    qb.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          id: 'mem-1',
          role: 'admin',
          tenant: { id: 't1', name: 'Test Co', slug: 'test-co' },
        },
        error: null,
      })
    mockSupabase.from.mockReturnValue(qb)

    const app = new Hono()
    app.use('*', requirePortalSession)
    app.get('/test', (c) => c.json((c.var as any).portalSession))

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.user_id).toBe('user-1')
    expect(body.email).toBe('test@test.com')
    expect(body.tenant_id).toBe('t1')
    expect(body.tenant_slug).toBe('test-co')
    expect(body.tenant_name).toBe('Test Co')
    expect(body.role).toBe('admin')
    expect(body.membership_id).toBe('mem-1')
    expect(body.is_super_admin).toBe(false)
  })

  it('sets portalSession with is_super_admin=true for platform admin', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@test.com' } },
      error: null,
    })

    const qb = chainQB()
    qb.maybeSingle
      .mockResolvedValueOnce({ data: { id: 'pa-1' }, error: null }) // platform_admin found
      .mockResolvedValueOnce({
        data: {
          id: 'mem-2',
          role: 'owner',
          tenant: { id: 't1', name: 'Test Co', slug: 'test-co' },
        },
        error: null,
      })
    mockSupabase.from.mockReturnValue(qb)

    const app = new Hono()
    app.use('*', requirePortalSession)
    app.get('/test', (c) => c.json((c.var as any).portalSession))

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer admin-jwt' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.user_id).toBe('admin-1')
    expect(body.is_super_admin).toBe(true)
    expect(body.role).toBe('owner')
  })
})

describe('requirePortalRole', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })

    const qb = chainQB()
    qb.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // not platform admin
      .mockResolvedValueOnce({
        data: {
          id: 'mem-1',
          role: 'editor',
          tenant: { id: 't1', name: 'Test Co', slug: 'test-co' },
        },
        error: null,
      })
    mockSupabase.from.mockReturnValue(qb)
  })

  it('calls next() when role matches', async () => {
    const app = new Hono()
    app.use('*', requirePortalSession)
    app.get('/edit', requirePortalRole('editor'), (c) => c.json({ ok: true }))

    const res = await app.request('/edit', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
  })

  it('returns 403 when role does not match', async () => {
    const app = new Hono()
    app.use('*', requirePortalSession)
    app.get('/admin', requirePortalRole('admin'), (c) => c.json({ ok: true }))

    const res = await app.request('/admin', {
      headers: { Authorization: 'Bearer valid-jwt' },
    })
    expect(res.status).toBe(403)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toContain('admin')
  })
})

describe('requireSuperAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls next() for super admin', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'admin-1', email: 'admin@test.com' } },
      error: null,
    })

    const qb = chainQB()
    qb.maybeSingle
      .mockResolvedValueOnce({ data: { id: 'pa-1' }, error: null }) // super admin
      .mockResolvedValueOnce({
        data: {
          id: 'mem-1',
          role: 'admin',
          tenant: { id: 't1', name: 'Test Co', slug: 'test-co' },
        },
        error: null,
      })
    mockSupabase.from.mockReturnValue(qb)

    const app = new Hono()
    app.use('*', requirePortalSession)
    app.get('/super', requireSuperAdmin(), (c) => c.json({ ok: true }))

    const res = await app.request('/super', {
      headers: { Authorization: 'Bearer admin-jwt' },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)
  })

  it('returns 403 for non-admin user', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })

    const qb = chainQB()
    qb.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // not platform admin
      .mockResolvedValueOnce({
        data: {
          id: 'mem-1',
          role: 'admin',
          tenant: { id: 't1', name: 'Test Co', slug: 'test-co' },
        },
        error: null,
      })
    mockSupabase.from.mockReturnValue(qb)

    const app = new Hono()
    app.use('*', requirePortalSession)
    app.get('/super', requireSuperAdmin(), (c) => c.json({ ok: true }))

    const res = await app.request('/super', {
      headers: { Authorization: 'Bearer user-jwt' },
    })
    expect(res.status).toBe(403)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe('Super admin access required')
  })
})
