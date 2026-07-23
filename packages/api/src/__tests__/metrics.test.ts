// ──────────────────────────────────────────────────────
// @tenantscale/api — Metrics Module Tests
// ──────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest'
import metrics, { collectMetrics, resetMetrics } from '../lib/metrics.js'

describe('Prometheus metrics registry', () => {
  beforeEach(() => {
    resetMetrics()
  })

  describe('Counter', () => {
    it('starts empty after reset (no data emitted until first inc)', () => {
      const output = collectMetrics()
      // HELP and TYPE lines always present
      expect(output).toContain('# HELP tenantscale_requests_total Total request count')
      expect(output).toContain('# TYPE tenantscale_requests_total counter')
      // But no data line until inc() is called
      expect(output).not.toMatch(/^tenantscale_requests_total\s+\d+/m)
    })

    it('increments without labels', () => {
      metrics.requestsTotal.inc()
      metrics.requestsTotal.inc()
      const output = collectMetrics()
      expect(output).toMatch(/^tenantscale_requests_total 2$/m)
    })

    it('increments with labels', () => {
      metrics.requestsTotal.inc({ method: 'GET', path: '/v1/tenants', status: '200', plan: 'pro' })
      metrics.requestsTotal.inc({ method: 'GET', path: '/v1/tenants', status: '200', plan: 'pro' })
      metrics.requestsTotal.inc({ method: 'POST', path: '/v1/tenants', status: '201', plan: 'free' })
      const output = collectMetrics()

      expect(output).toContain('tenantscale_requests_total{method="GET",path="/v1/tenants",status="200",plan="pro"} 2')
      expect(output).toContain('tenantscale_requests_total{method="POST",path="/v1/tenants",status="201",plan="free"} 1')
    })

    it('has both total and labeled counts', () => {
      metrics.requestsTotal.inc({ method: 'GET', path: '/', status: '200', plan: 'hobby' })
      const output = collectMetrics()
      expect(output).toContain('tenantscale_requests_total{')
    })

    it('includes HELP and TYPE lines', () => {
      const output = collectMetrics()
      expect(output).toContain('# HELP tenantscale_requests_total')
      expect(output).toContain('# TYPE tenantscale_requests_total counter')
    })
  })

  describe('Histogram', () => {
    it('records observations in correct buckets', () => {
      metrics.requestDuration.observe(3, { method: 'GET', path: '/v1/tenants' })
      metrics.requestDuration.observe(30, { method: 'GET', path: '/v1/tenants' })
      metrics.requestDuration.observe(300, { method: 'GET', path: '/v1/tenants' })

      const output = collectMetrics()
      expect(output).toContain('tenantscale_request_duration_ms_bucket{method="GET",path="/v1/tenants",le="5"} 1')
      expect(output).toContain('tenantscale_request_duration_ms_bucket{method="GET",path="/v1/tenants",le="50"} 1')
      expect(output).toContain('tenantscale_request_duration_ms_bucket{method="GET",path="/v1/tenants",le="500"} 1')
    })

    it('records count and sum', () => {
      metrics.requestDuration.observe(10, { method: 'GET', path: '/test' })
      metrics.requestDuration.observe(20, { method: 'GET', path: '/test' })

      const output = collectMetrics()
      expect(output).toContain('tenantscale_request_duration_ms_count{method="GET",path="/test"} 2')
      expect(output).toContain('tenantscale_request_duration_ms_sum{method="GET",path="/test"} 30')
    })

    it('includes +Inf bucket', () => {
      metrics.requestDuration.observe(100000, { method: 'GET', path: '/slow' })

      const output = collectMetrics()
      expect(output).toContain('tenantscale_request_duration_ms_bucket{method="GET",path="/slow",le="+Inf"}')
    })
  })

  describe('Gauge', () => {
    it('sets and reports values', () => {
      metrics.activeTenants.set(42)
      const output = collectMetrics()
      expect(output).toMatch(/^tenantscale_active_tenants 42$/m)
    })

    it('updates overwrite previous values', () => {
      metrics.activeTenants.set(10)
      metrics.activeTenants.set(20)
      const output = collectMetrics()
      expect(output).toMatch(/^tenantscale_active_tenants 20$/m)
    })

    it('supports label dimensions', () => {
      metrics.apiCallsRemaining.set(500, { tenant: 'tenant_abc', plan: 'pro' })
      const output = collectMetrics()
      expect(output).toContain('tenantscale_api_calls_remaining{tenant="tenant_abc",plan="pro"} 500')
    })
  })

  describe('resetMetrics', () => {
    it('clears all observed data so nothing emits', () => {
      metrics.requestsTotal.inc()
      metrics.requestDuration.observe(100, { method: 'GET', path: '/test' })
      metrics.activeTenants.set(5)

      resetMetrics()

      const output = collectMetrics()
      // HELP/TYPE still present but no data lines
      expect(output).toContain('# HELP tenantscale_requests_total')
      expect(output).not.toMatch(/^tenantscale_requests_total\s+\d+/m)
      // No gauge data lines after reset
      expect(output).not.toMatch(/^tenantscale_active_tenants\s+\d+/m)
      expect(output).not.toMatch(/^tenantscale_request_duration_ms_count\s+\d+/m)
      expect(output).not.toMatch(/^tenantscale_request_duration_ms_sum\s+\d+/m)
    })
  })

  describe('All metrics present', () => {
    it('exports all expected metric names', () => {
      metrics.requestsTotal.inc()
      metrics.requestDuration.observe(1, { method: 'GET', path: '/' })
      metrics.authFailures.inc({ reason: 'invalid_key' })
      metrics.rateLimitHits.inc({ type: 'daily' })
      metrics.activeTenants.set(1)
      metrics.apiCallsRemaining.set(100, { tenant: 't1', plan: 'free' })
      metrics.webhookDeliveries.inc({ status: 'delivered' })
      metrics.stripeApiCalls.inc({ operation: 'create_checkout' })

      const output = collectMetrics()
      const expected = [
        'tenantscale_requests_total',
        'tenantscale_request_duration_ms',
        'tenantscale_auth_failures_total',
        'tenantscale_ratelimit_hits_total',
        'tenantscale_active_tenants',
        'tenantscale_api_calls_remaining',
        'tenantscale_webhook_deliveries_total',
        'tenantscale_stripe_api_calls_total',
      ]
      for (const name of expected) {
        expect(output).toContain(name)
      }
    })

    it('output has valid Prometheus exposition lines', () => {
      metrics.requestsTotal.inc({ method: 'GET', path: '/v1/test', status: '200', plan: 'free' })
      metrics.requestDuration.observe(42, { method: 'GET', path: '/v1/test' })
      metrics.activeTenants.set(7)

      const output = collectMetrics()
      const lines = output.trim().split('\n')
      const dataLines = lines.filter(l => !l.startsWith('#') && l.trim() !== '')

      // Every data line matches Prometheus text format:
      //   metric_name{labels} value
      for (const line of dataLines) {
        expect(line).toMatch(
          /^[a-zA-Z_][a-zA-Z0-9_]*(?:_bucket|_count|_sum)?(?:\{[^}]+\})?\s+-?\d+(?:\.\d+)?$/
        )
      }

      // Counter should have HELP + TYPE + 1 data line
      const counterLines = lines.filter(l => l.includes('tenantscale_requests_total'))
      expect(counterLines.filter(l => l.startsWith('#'))).toHaveLength(2) // HELP + TYPE
      expect(counterLines.filter(l => !l.startsWith('#'))).toHaveLength(1) // data
    })
  })
})
