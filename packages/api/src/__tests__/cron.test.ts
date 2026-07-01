// ──────────────────────────────────────────────────────
// TenantScale API — Cron route tests
// ──────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// ── Mock Supabase ──
const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
}
vi.mock('../db/supabase', () => ({ supabase: mockSupabase }))

// Set cron secret for testing
process.env.CRON_SECRET = 'test-cron-secret-123'

const { cronRoutes } = await import('../routes/cron')

function makeApp(): Hono {
  return new Hono().basePath('/v1').route('/', cronRoutes)
}

function chainQB() {
  const qb: Record<string, unknown> = {}
  qb.select = vi.fn().mockReturnThis()
  qb.insert = vi.fn().mockReturnThis()
  qb.not = vi.fn().mockReturnThis()
  qb.eq = vi.fn().mockReturnThis()
  qb.in = vi.fn().mockReturnThis()
  qb.lt = vi.fn().mockReturnThis()
  qb.limit = vi.fn().mockReturnThis()
  qb.single = vi.fn()
  qb.order = vi.fn().mockReturnThis()
  qb.range = vi.fn().mockReturnThis()
  return qb as unknown as Record<string, ReturnType<typeof vi.fn>>
}

describe('POST /admin/cron/cleanup-audit', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = makeApp()
  })

  it('rejects request without X-Cron-Secret or Authorization header', async () => {
    const res = await app.request('/v1/admin/cron/cleanup-audit', {
      method: 'POST',
    })
    expect(res.status).toBe(401)
    const body = await res.json() as any
    expect(body.error).toBe('Invalid cron secret')
  })

  it('rejects request with wrong cron secret', async () => {
    const res = await app.request('/v1/admin/cron/cleanup-audit', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'wrong-secret' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects request when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const res = await app.request('/v1/admin/cron/cleanup-audit', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'test-cron-secret-123' },
    })
    expect(res.status).toBe(503)
    const body = await res.json() as any
    expect(body.error).toBe('Cron not configured on server')
    process.env.CRON_SECRET = 'test-cron-secret-123'
  })

  it('calls RPC and returns per-plan deletion summary on success', async () => {
    const mockResult = [
      { plan_id: 'free', deleted_rows: '42' },
      { plan_id: 'hobby', deleted_rows: '17' },
      { plan_id: 'pro', deleted_rows: '5' },
    ]
    mockSupabase.rpc.mockResolvedValue({ data: mockResult, error: null })

    const res = await app.request('/v1/admin/cron/cleanup-audit', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'test-cron-secret-123' },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.success).toBe(true)
    expect(body.total_deleted).toBe(64)
    expect(body.per_plan).toHaveLength(3)
    expect(body.duration_ms).toBeGreaterThanOrEqual(0)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('cleanup_expired_audit_events')
  })

  it('handles empty RPC result (nothing to delete)', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

    const res = await app.request('/v1/admin/cron/cleanup-audit', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'test-cron-secret-123' },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.success).toBe(true)
    expect(body.total_deleted).toBe(0)
    expect(body.per_plan).toEqual([])
  })

  it('returns 500 when RPC returns error', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'function not found' },
    })

    const res = await app.request('/v1/admin/cron/cleanup-audit', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'test-cron-secret-123' },
    })

    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('Audit cleanup failed')
  })

  it('returns 500 when RPC throws', async () => {
    mockSupabase.rpc.mockRejectedValue(new Error('DB connection failed'))

    const res = await app.request('/v1/admin/cron/cleanup-audit', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'test-cron-secret-123' },
    })

    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('Audit cleanup threw unexpected error')
  })
})

describe('GET /admin/cron/status', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    app = makeApp()
  })

  it('rejects request without auth', async () => {
    const res = await app.request('/v1/admin/cron/status', { method: 'GET' })
    expect(res.status).toBe(401)
  })

  it('returns dry-run summary (empty when no plans)', async () => {
    // Build a proper thenable chain
    const qb = chainQB()
    // .not() is the terminal call — make it thenable
    const thenableResult = Promise.resolve({ data: [], error: null })
    qb.not = vi.fn().mockReturnValue(thenableResult)

    // Setup .select() → .not() chain
    qb.select = vi.fn().mockReturnValue(qb)
    qb.not = vi.fn().mockResolvedValue({ data: [], error: null })

    mockSupabase.from.mockReturnValue(qb)

    const res = await app.request('/v1/admin/cron/status', {
      method: 'GET',
      headers: { 'X-Cron-Secret': 'test-cron-secret-123' },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.dry_run).toBe(true)
    expect(body.per_plan).toEqual([])
    expect(body.total_expired).toBe(0)
  })

  it('returns 500 when plan fetch fails', async () => {
    const qb = chainQB()
    qb.select = vi.fn().mockReturnValue(qb)
    qb.not = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    })

    mockSupabase.from.mockReturnValue(qb)

    const res = await app.request('/v1/admin/cron/status', {
      method: 'GET',
      headers: { 'X-Cron-Secret': 'test-cron-secret-123' },
    })

    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBe('Failed to fetch plans')
  })
})
