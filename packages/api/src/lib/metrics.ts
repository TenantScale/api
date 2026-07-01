// ──────────────────────────────────────────────────────
// TenantScale — Prometheus Metrics Registry
// ──────────────────────────────────────────────────────
// Home‑grown counters / histograms / gauges so we have
// zero external dependency.  The interface is designed to
// be swappable for OpenTelemetry later.
// ──────────────────────────────────────────────────────

import type { Context } from 'hono'

// ── Metric interfaces ──
interface Counter { inc(labels?: Record<string, string>): void }
interface Histogram { observe(value: number, labels?: Record<string, string>): void }
interface Gauge { set(value: number, labels?: Record<string, string>): void }

// ── Counter ──
class PromCounter implements Counter {
  private data = new Map<string, number>()
  constructor(
    public name: string,
    public help: string,
    public labelNames: string[] = [],
  ) {}

  inc(labels?: Record<string, string>): void {
    const key = labels ? JSON.stringify(labels) : '__total'
    this.data.set(key, (this.data.get(key) ?? 0) + 1)
  }

  collect(): string {
    let output = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} counter\n`
    for (const [key, val] of this.data) {
      if (key === '__total') {
        output += `${this.name} ${val}\n`
      } else {
        const labels = JSON.parse(key) as Record<string, string>
        const labelStr = Object.entries(labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',')
        output += `${this.name}{${labelStr}} ${val}\n`
      }
    }
    return output
  }

  reset(): void {
    this.data.clear()
  }
}

// ── Histogram ──
class PromHistogram implements Histogram {
  private buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
  private data = new Map<string, Map<string, number>>()

  constructor(
    public name: string,
    public help: string,
    public labelNames: string[] = [],
  ) {}

  observe(value: number, labels?: Record<string, string>): void {
    const key = labels ? JSON.stringify(labels) : '__total'
    if (!this.data.has(key)) this.data.set(key, new Map())

    const bucketMap = this.data.get(key)!
    for (const b of this.buckets) {
      if (value <= b) {
        bucketMap.set(String(b), (bucketMap.get(String(b)) ?? 0) + 1)
        break
      }
    }
    bucketMap.set('+Inf', (bucketMap.get('+Inf') ?? 0) + 1)
    bucketMap.set('count', (bucketMap.get('count') ?? 0) + 1)
    bucketMap.set('sum', (bucketMap.get('sum') ?? 0) + value)
  }

  reset(): void {
    this.data.clear()
  }

  collect(): string {
    let output = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} histogram\n`
    for (const [key, bucketMap] of this.data) {
      // Parse JSON label key into Prometheus label string (comma-separated, no trailing comma)
      let labelStr = ''
      if (key !== '__total') {
        const labels = JSON.parse(key) as Record<string, string>
        labelStr = Object.entries(labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',')
      }
      // When labels are present, they separate name from _bucket/count/sum suffix:
      //   metric_name{labels}_bucket{le="X"}  — WRONG
      //   metric_name_bucket{labels,le="X"}  — CORRECT
      // So we use labelPrefix="{labels," (or empty if no labels) and combine with le label
      const labelPrefix = labelStr ? `${labelStr},` : ''

      const sortedBuckets = [...bucketMap.entries()]
        .filter(([k]) => !['+Inf', 'count', 'sum'].includes(k))
        .sort(([a], [b]) => Number(a) - Number(b))

      for (const [upper, count] of sortedBuckets) {
        output += `${this.name}_bucket{${labelPrefix}le="${upper}"} ${count}\n`
      }

      const count = bucketMap.get('count') ?? 0
      const sum = bucketMap.get('sum') ?? 0
      output += `${this.name}_bucket{${labelPrefix}le="+Inf"} ${count}\n`
      // For _count and _sum, labels are only present when labelPrefix is non-empty
      if (labelStr) {
        output += `${this.name}_count{${labelStr}} ${count}\n`
        output += `${this.name}_sum{${labelStr}} ${sum}\n`
      } else {
        output += `${this.name}_count ${count}\n`
        output += `${this.name}_sum ${sum}\n`
      }
    }
    return output
  }
}

// ── Gauge ──
class PromGauge implements Gauge {
  private data = new Map<string, number>()

  constructor(
    public name: string,
    public help: string,
    public labelNames: string[] = [],
  ) {}

  set(value: number, labels?: Record<string, string>): void {
    const key = labels ? JSON.stringify(labels) : '__total'
    this.data.set(key, value)
  }

  reset(): void {
    this.data.clear()
  }

  collect(): string {
    let output = `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} gauge\n`
    for (const [key, val] of this.data) {
      if (key === '__total') {
        output += `${this.name} ${val}\n`
      } else {
        const labels = JSON.parse(key) as Record<string, string>
        const labelStr = Object.entries(labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',')
        output += `${this.name}{${labelStr}} ${val}\n`
      }
    }
    return output
  }
}

// ── Exported metrics ──
const metrics = {
  // Request metrics
  requestsTotal: new PromCounter(
    'tenantscale_requests_total',
    'Total request count',
    ['method', 'path', 'status', 'plan'],
  ),
  requestDuration: new PromHistogram(
    'tenantscale_request_duration_ms',
    'Request latency in ms',
    ['method', 'path'],
  ),

  // Auth metrics
  authFailures: new PromCounter(
    'tenantscale_auth_failures_total',
    'Authentication failures',
    ['reason'],
  ),

  // Rate limit metrics
  rateLimitHits: new PromCounter(
    'tenantscale_ratelimit_hits_total',
    'Rate limit exceeded',
    ['type'],
  ),

  // Business metrics
  activeTenants: new PromGauge(
    'tenantscale_active_tenants',
    'Active tenant count',
  ),
  apiCallsRemaining: new PromGauge(
    'tenantscale_api_calls_remaining',
    'Daily API calls remaining',
    ['tenant', 'plan'],
  ),

  // Webhook metrics
  webhookDeliveries: new PromCounter(
    'tenantscale_webhook_deliveries_total',
    'Webhook deliveries',
    ['status'],
  ),

  // Stripe metrics
  stripeApiCalls: new PromCounter(
    'tenantscale_stripe_api_calls_total',
    'Stripe API calls',
    ['operation'],
  ),
}

/** Export all metrics as Prometheus text format */
export function collectMetrics(): string {
  let output = ''
  for (const m of Object.values(metrics)) {
    if (typeof (m as any).collect === 'function') {
      output += (m as any).collect() + '\n'
    }
  }
  return output
}

/** Reset all metrics (for testing) */
export function resetMetrics(): void {
  for (const m of Object.values(metrics)) {
    if (typeof (m as any).reset === 'function') (m as any).reset()
  }
}

export default metrics
