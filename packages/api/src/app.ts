// ──────────────────────────────────────────────────────
// TenantScale API — Hono App Definition
// ──────────────────────────────────────────────────────
// Shared between local dev (index.ts) and Vercel (api/bundle.js)
//
// Endpoints:
//   POST /v1/tenants          — Create a new tenant
//   GET  /v1/tenants/me       — Get current tenant (via API key)
//   GET  /v1/tenants          — List tenants (admin key)
//   GET  /v1/tenants/:id      — Get tenant by ID
//   PATCH /v1/tenants/:id     — Update tenant
//   POST /v1/tenants/:id/api-keys — Generate API key
//   POST /v1/audit            — Log audit event (from SDK)
//   GET  /v1/audit            — Get tenant audit log
//   POST /v1/events           — Track usage event
//   GET  /v1/events/summary   — Usage summary
//   POST /v1/admin/impersonate         — Create impersonation session
//   POST /v1/admin/impersonate/:id/revoke — Revoke impersonation
//   GET  /v1/admin/audit                — Cross-tenant audit log (admin key)
//   GET  /v1/admin/tenants              — List all tenants
//   GET  /v1/admin/tenants/:id          — Tenant detail with stats
//   GET  /v1/admin/tenants/:id/users    — Tenant users
//   POST /v1/admin/tenants              — Create tenant
//   PATCH /v1/admin/tenants/:id         — Update tenant
//   DELETE /v1/admin/tenants/:id        — Delete tenant
//   GET  /v1/admin/tenants/:id/api-keys     — List tenant API keys
//   POST /v1/admin/tenants/:id/api-keys     — Create API key
//   DELETE /v1/admin/tenants/:id/api-keys/:keyId — Revoke API key
//   GET  /v1/admin/plans                — List plans
//   PATCH /v1/admin/plans/:id           — Update plan
//   GET  /v1/admin/stats                — Platform stats
//   GET  /v1/admin/users/:userId/tenants — List user's tenant memberships (SDK BYOA)
//   POST /v1/admin/tenants/:id/users     — Add user to tenant
//   PATCH /v1/admin/tenants/:id/users/:userId/role — Change user role
//   DELETE /v1/admin/tenants/:id/users/:userId — Remove user from tenant
//   GET  /v1/portal/me             — Portal: current user + tenant
//   GET  /v1/portal/users          — Portal: list tenant users
//   POST /v1/portal/users/invite   — Portal: invite user (owner/admin)
//   DELETE /v1/portal/users/:id    — Portal: remove user (owner/admin)
//   PATCH /v1/portal/users/:id/role — Portal: change role (owner/admin)
//   POST /v1/portal/leave          — Portal: leave tenant
//   GET  /v1/portal/api-keys       — Portal: list API keys
//   POST /v1/portal/api-keys       — Portal: create API key (owner/admin)
//   DELETE /v1/portal/api-keys/:id — Portal: revoke API key (owner/admin)
//   GET  /v1/portal/audit          — Portal: tenant audit log
//   PATCH /v1/portal/settings      — Portal: update tenant settings (owner/admin)
//   POST /v1/portal/transfer-ownership — Portal: transfer ownership (owner)
//   POST /v1/portal/register         — Public: sign up + create tenant
// ──────────────────────────────────────────────────────

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { logger } from './lib/logger'
import { createDdosGuard, createPlanRateLimiter } from './middleware/rate-limit'
import { metricsMiddleware, metricsEndpoint } from './middleware/metrics'
import { captureException } from './lib/error-tracking'

const APP_VERSION = '0.1.0'

const DEFAULT_CORS_ORIGINS = ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003']

import { tenantRoutes } from './routes/tenants'
import { auditRoutes } from './routes/audit'
import { adminRoutes } from './routes/admin'
import { eventRoutes } from './routes/events'
import { planRoutes } from './routes/plans'
import { portalRoutes } from './routes/portal'
import { adminPortalRoutes } from './routes/admin-portal'
import { webhookRoutes } from './routes/webhooks'
import { cronRoutes } from './routes/cron'
import { stripeWebhookRoutes } from './routes/stripe-webhook'
import { subscriptionRoutes } from './routes/subscriptions'
import { statusRoutes } from './routes/status'
import { analyticsRoutes } from './routes/analytics'

const app = new Hono()

// ── Health check (BEFORE global rate limiter so monitoring tools are never blocked) ──
app.get('/health', async (c) => {
  // Ping the DB to confirm connectivity
  let dbOk = false
  const { supabase } = await import('./db/supabase')
  try {
    const { error } = await supabase.from('tenants').select('id', { count: 'exact', head: true }).limit(1)
    dbOk = !error
  } catch (err) {
    logger.warn(err, 'Health check DB ping failed')
  }
  return c.json({
    status: dbOk ? 'ok' : 'degraded',
    version: APP_VERSION,
    uptime: Math.floor(process.uptime()),
    db: dbOk ? 'connected' : 'unreachable',
  })
})

// ── Metrics endpoint (BEFORE global rate limiter so monitoring tools are never blocked) ──
app.get('/metrics', metricsEndpoint)

// ── Global middleware ──
const corsOrigins = process.env.CORS_ORIGIN?.split(',').map(o => o.trim()).filter(Boolean) ?? DEFAULT_CORS_ORIGINS
app.use('*', cors({
  origin: corsOrigins,
  allowHeaders: ['Authorization', 'Content-Type', 'X-TenantScale-Version'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}))
app.use('*', secureHeaders())

// ── Request ID middleware ──
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-Id') ?? crypto.randomUUID()
  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)
  await next()
})

// ── Structured logging (Hono-compatible pino-http wrapper) ──
app.use('*', async (c, next) => {
  const start = Date.now()
  const requestId = c.get('requestId') ?? 'unknown'

  const childLogger = logger.child({
    req: {
      id: requestId,
      method: c.req.method,
      url: c.req.url,
    },
  })

  childLogger.info({ req: { method: c.req.method, url: c.req.url } }, 'incoming request')

  await next()

  const responseTime = Date.now() - start
  childLogger.info(
    { res: { statusCode: c.res.status }, responseTime },
    'request completed',
  )
})
app.use('*', createDdosGuard({ maxRequests: 2000, windowMs: 60000 }))

// ── Stripe webhook (outside v1 — no API key auth, no plan rate limiter) ──
app.route('/', stripeWebhookRoutes)

// ── API v1 routes ──
const v1 = app.basePath('/v1')
v1.use('*', createPlanRateLimiter())
v1.use('*', metricsMiddleware)
v1.route('/', tenantRoutes)
v1.route('/', auditRoutes)
v1.route('/', adminRoutes)
v1.route('/', eventRoutes)
v1.route('/', planRoutes)
v1.route('/', portalRoutes)
v1.route('/', adminPortalRoutes)
v1.route('/', webhookRoutes)
v1.route('/', cronRoutes)
v1.route('/', subscriptionRoutes)
v1.route('/', statusRoutes)
v1.route('/', analyticsRoutes)

// ── 404 handler ──
app.notFound((c) => c.json({ error: 'Not found' }, 404))

// ── Error handler ──
app.onError((err, c) => {
  captureException(err instanceof Error ? err : new Error(String(err)), {
    method: c.req.method,
    path: c.req.path,
    requestId: c.get('requestId'),
  })
  logger.error(err, 'Unhandled error')
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
