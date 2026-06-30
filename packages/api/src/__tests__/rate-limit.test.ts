// ──────────────────────────────────────────────────────
// Rate Limiter Middleware — unit tests
// ──────────────────────────────────────────────────────

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createDdosGuard, createPlanRateLimiter } from '../middleware/rate-limit'

// Hono Variables type so c.set/c.get('apiKey') are recognized
type Variables = {
  apiKey?: { tenant_id: string }
}

// ── Fixed tenant-id (authenticated) ──
describe('with authenticated tenant', () => {
  let app: Hono<{ Variables: Variables }>

  beforeEach(() => {
    app = new Hono<{ Variables: Variables }>()
    app.use('*', (c, next) => {
      c.set('apiKey', { tenant_id: 'tenant-1' })
      return next()
    })
    app.use('*', createDdosGuard({ maxRequests: 5, windowMs: 60_000 }))
    app.get('/test', (c) => c.json({ ok: true }))
  })

  // Test 1: Allows requests under the limit
  it('allows requests under the limit', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/test')
      expect(res.status).toBe(200)
    }
  })

  // Test 2: Blocks requests over the limit
  it('blocks requests over the limit with 429', async () => {
    // Exhaust the 5 allowed requests
    for (let i = 0; i < 5; i++) await app.request('/test')

    const res = await app.request('/test')
    expect(res.status).toBe(429)

    const body = await res.json()
    expect(body.error).toBe('Too many requests')
    expect(body.retry_after).toBeTypeOf('number')
    expect(body.retry_after).toBeGreaterThan(0)
  })

  // Test 3: Sets correct rate limit headers
  it('sets correct rate limit headers on the response', async () => {
    const res1 = await app.request('/test')

    expect(res1.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('4')

    const reset = Number(res1.headers.get('X-RateLimit-Reset'))
    expect(Number.isInteger(reset)).toBe(true)
    expect(reset).toBeGreaterThan(0)

    // Exhaust remaining requests
    for (let i = 0; i < 4; i++) await app.request('/test')
    const res6 = await app.request('/test')

    // Remaining should be 0 on the 6th request (429)
    expect(res6.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(res6.status).toBe(429)
  })
})

// ── Independent counters per tenant ──
describe('different client IPs have independent counters', () => {
  it('tracks counters separately per client IP', async () => {
    const app = new Hono()
    app.use('*', createDdosGuard({ maxRequests: 3, windowMs: 60_000 }))
    app.get('/test', (c) => c.json({ ok: true }))

    const headers = (ip: string) => ({ 'x-forwarded-for': ip })

    // Exhaust tenant-1 IP (3 requests allowed)
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/test', { headers: headers('203.0.113.1') })
      expect(res.status).toBe(200)
    }
    let res = await app.request('/test', { headers: headers('203.0.113.1') })
    expect(res.status).toBe(429)

    // Switch to tenant-2 IP — should have a fresh counter
    res = await app.request('/test', { headers: headers('203.0.113.2') })
    expect(res.status).toBe(200)

    // Switch back to tenant-1 IP — still blocked
    res = await app.request('/test', { headers: headers('203.0.113.1') })
    expect(res.status).toBe(429)
  })
})

// ── Window expiry ──
describe('counter resets after window expires', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resets counter after the time window passes', async () => {
    vi.useFakeTimers()

    const app = new Hono<{ Variables: Variables }>()
    app.use('*', (c, next) => {
      c.set('apiKey', { tenant_id: 'tenant-1' })
      return next()
    })
    app.use('*', createDdosGuard({ maxRequests: 5, windowMs: 60_000 }))
    app.get('/test', (c) => c.json({ ok: true }))

    // Exhaust the 5 allowed requests
    for (let i = 0; i < 5; i++) await app.request('/test')
    let res = await app.request('/test')
    expect(res.status).toBe(429)

    // Advance past the window
    vi.advanceTimersByTime(60_001)

    // Counter should be reset — request should succeed
    res = await app.request('/test')
    expect(res.status).toBe(200)
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4')
  })
})

// ── IP fallback ──
describe('falls back to IP when no tenant_id is available', () => {
  it('uses x-forwarded-for header as the rate-limit key', async () => {
    const app = new Hono()
    app.use('*', createDdosGuard({ maxRequests: 3, windowMs: 60_000 }))
    app.get('/test', (c) => c.json({ ok: true }))

    // Exhaust IP 203.0.113.1
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/test', {
        headers: { 'x-forwarded-for': '203.0.113.1' },
      })
      expect(res.status).toBe(200)
    }

    // Same IP — blocked
    let res = await app.request('/test', {
      headers: { 'x-forwarded-for': '203.0.113.1' },
    })
    expect(res.status).toBe(429)

    // Different IP — still has capacity
    res = await app.request('/test', {
      headers: { 'x-forwarded-for': '203.0.113.2' },
    })
    expect(res.status).toBe(200)
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    const app = new Hono()
    app.use('*', createDdosGuard({ maxRequests: 1, windowMs: 60_000 }))
    app.get('/test', (c) => c.json({ ok: true }))

    // First request from 10.0.0.1 — allowed
    let res = await app.request('/test', {
      headers: { 'x-real-ip': '10.0.0.1' },
    })
    expect(res.status).toBe(200)

    // Second request from same IP — blocked
    res = await app.request('/test', {
      headers: { 'x-real-ip': '10.0.0.1' },
    })
    expect(res.status).toBe(429)
  })

  it('falls back to "unknown" when no IP headers are present', async () => {
    const app = new Hono()
    app.use('*', createDdosGuard({ maxRequests: 1, windowMs: 60_000 }))
    app.get('/test', (c) => c.json({ ok: true }))

    let res = await app.request('/test')
    expect(res.status).toBe(200)

    // Second request from same "unknown" source — blocked
    res = await app.request('/test')
    expect(res.status).toBe(429)
  })
})
