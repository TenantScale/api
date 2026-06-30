// ──────────────────────────────────────────────────────
// Webhook Dispatcher — unit tests
// ──────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dispatchWebhook, __TEST_RETRIES } from '../lib/webhook-dispatcher'

// ── Mock Supabase ──
const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: { from: vi.fn() },
}))
vi.mock('../db/supabase', () => ({ supabase: mockSupabase }))

// ── Mock SSRF validation (avoids real DNS lookups in tests) ──
vi.mock('../lib/ssrf', () => ({
  validateWebhookUrl: vi.fn().mockImplementation(async (urlStr: string) => {
    return new URL(urlStr)
  }),
}))

/**
 * Returns a query builder mock where chain methods return `this`.
 * Terminal methods resolve with { data, error }.
 */
function chainQB() {
  const qb: Record<string, unknown> = {}
  qb.select = vi.fn().mockReturnThis()
  qb.insert = vi.fn().mockResolvedValue({ data: null, error: null })
  qb.eq = vi.fn().mockReturnThis()
  qb.contains = vi.fn().mockResolvedValue({ data: [], error: null })
  qb.order = vi.fn().mockReturnThis()
  qb.limit = vi.fn().mockReturnThis()
  qb.single = vi.fn().mockResolvedValue({ data: null, error: null })
  // Support both .then(undefined, fn) and await patterns
  qb.then = vi.fn().mockImplementation((resolve: (value: unknown) => void) => {
    resolve({ data: null, error: null })
    return Promise.resolve({ data: null, error: null })
  })
  return qb as unknown as {
    select: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    contains: ReturnType<typeof vi.fn>
    single: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    then: ReturnType<typeof vi.fn>
  }
}

/** Flush micro-task queue so fire-and-forget promises settle */
const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Create a mock successful fetch response */
function okResponse(text = 'OK') {
  return { ok: true, status: 200, text: () => Promise.resolve(text) }
}

describe('Webhook Dispatcher', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let webhookQB: ReturnType<typeof chainQB>
  let deliveryQB: ReturnType<typeof chainQB>

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.WEBHOOK_LOG_BODIES

    // Mock global fetch
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    // Separate query builders for the two supabase tables
    webhookQB = chainQB()
    deliveryQB = chainQB()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'webhook_deliveries') return deliveryQB
      return webhookQB
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ── Test 1: No webhooks match ──
  it('does nothing when no webhooks match', async () => {
    webhookQB.contains.mockResolvedValue({ data: [], error: null })

    dispatchWebhook('tenant.created', 'tenant-1', { name: 'Test' })
    await flushPromises()

    expect(mockFetch).not.toHaveBeenCalled()
    expect(deliveryQB.insert).not.toHaveBeenCalled()
  })

  // ── Test 2: POST with correct payload shape ──
  it('POSTs to matching webhook URLs with correct payload shape', async () => {
    webhookQB.contains.mockResolvedValue({
      data: [
        { id: 'hook-1', url: 'https://example.com/hook', secret: 'secret-1' },
      ],
      error: null,
    })
    mockFetch.mockResolvedValue(okResponse())

    dispatchWebhook('tenant.created', 'tenant-1', { name: 'Test Co' })
    await flushPromises()

    expect(mockFetch).toHaveBeenCalledTimes(1)

    const fetchUrl = mockFetch.mock.calls[0][0]
    expect(fetchUrl).toBe('https://example.com/hook')

    const fetchOptions = mockFetch.mock.calls[0][1]
    expect(fetchOptions.method).toBe('POST')

    const body = JSON.parse(fetchOptions.body)
    expect(body).toMatchObject({
      event: 'tenant.created',
      tenant_id: 'tenant-1',
      data: { name: 'Test Co' },
    })
    expect(body.created_at).toBeTypeOf('string')
  })

  // ── Test 3: Correct headers ──
  it('sets correct webhook headers (Content-Type, Event, Signature, Delivery)', async () => {
    webhookQB.contains.mockResolvedValue({
      data: [
        { id: 'hook-1', url: 'https://example.com/hook', secret: 'my-secret' },
      ],
      error: null,
    })
    mockFetch.mockResolvedValue(okResponse())

    dispatchWebhook('tenant.created', 'tenant-1', { name: 'Test' })
    await flushPromises()

    const headers = mockFetch.mock.calls[0][1].headers
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-TenantScale-Event']).toBe('tenant.created')
    expect(headers['X-TenantScale-Signature']).toBeTypeOf('string')
    expect(headers['X-TenantScale-Signature'].length).toBeGreaterThan(0)
    expect(headers['X-TenantScale-Delivery']).toBeTypeOf('string')
    expect(headers['X-TenantScale-Delivery'].length).toBeGreaterThan(0)
  })

  // ── Test 4: Logs successful delivery ──
  it('logs a successful delivery to webhook_deliveries', async () => {
    process.env.WEBHOOK_LOG_BODIES = 'true'

    webhookQB.contains.mockResolvedValue({
      data: [
        { id: 'hook-1', url: 'https://example.com/hook', secret: 'secret-1' },
      ],
      error: null,
    })
    mockFetch.mockResolvedValue(okResponse('Delivered'))

    dispatchWebhook('tenant.created', 'tenant-1', { name: 'Test' })
    await flushPromises()

    expect(deliveryQB.insert).toHaveBeenCalledTimes(1)

    const insertData = deliveryQB.insert.mock.calls[0][0]
    expect(insertData).toMatchObject({
      webhook_id: 'hook-1',
      event_type: 'tenant.created',
      url: 'https://example.com/hook',
      response_status: 200,
      status: 'delivered',
      error_message: null,
    })
    expect(insertData.request_body).toBeTypeOf('string')
    expect(insertData.response_body).toBe('Delivered')
    expect(insertData.duration_ms).toBeTypeOf('number')
  })

  // ── Test 5: Failed delivery (non-200) ──
  it('logs a failed delivery when webhook URL returns non-200', async () => {
    process.env.WEBHOOK_LOG_BODIES = 'true'

    webhookQB.contains.mockResolvedValue({
      data: [
        { id: 'hook-1', url: 'https://example.com/hook', secret: 'secret-1' },
      ],
      error: null,
    })
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    })

    dispatchWebhook('tenant.created', 'tenant-1', { name: 'Test' })
    await flushPromises()

    expect(deliveryQB.insert).toHaveBeenCalledTimes(1)

    const insertData = deliveryQB.insert.mock.calls[0][0]
    expect(insertData).toMatchObject({
      response_status: 500,
      status: 'failed',
      error_message: 'HTTP 500',
    })
    expect(insertData.response_body).toBe('Internal Server Error')
  })

  // ── Test 6: Failed delivery (fetch throws) ──
  it('logs a failed delivery when fetch throws an error', async () => {
    // Disable retries to prevent timer leakage between tests
    __TEST_RETRIES.retries = 0

    webhookQB.contains.mockResolvedValue({
      data: [
        { id: 'hook-1', url: 'https://example.com/hook', secret: 'secret-1' },
      ],
      error: null,
    })
    mockFetch.mockRejectedValue(new Error('Network failure'))

    dispatchWebhook('tenant.created', 'tenant-1', { name: 'Test' })
    await flushPromises()

    expect(deliveryQB.insert).toHaveBeenCalledTimes(1)

    const insertData = deliveryQB.insert.mock.calls[0][0]
    expect(insertData).toMatchObject({
      response_status: null,
      response_body: null,
      status: 'failed',
      // Changed from exact error message since we're testing the insert shape
    })
    expect(insertData.error_message).toContain('Network failure')
  })

  // ── Test 7: Multiple webhooks ──
  it('calls multiple webhooks subscribed to the same event', async () => {
    webhookQB.contains.mockResolvedValue({
      data: [
        { id: 'hook-1', url: 'https://example.com/hook1', secret: 'secret-1' },
        { id: 'hook-2', url: 'https://example.com/hook2', secret: 'secret-2' },
      ],
      error: null,
    })
    mockFetch.mockResolvedValue(okResponse())

    dispatchWebhook('tenant.created', 'tenant-1', { name: 'Test' })
    await flushPromises()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[0][0]).toBe('https://example.com/hook1')
    expect(mockFetch.mock.calls[1][0]).toBe('https://example.com/hook2')

    expect(deliveryQB.insert).toHaveBeenCalledTimes(2)
  })
})
