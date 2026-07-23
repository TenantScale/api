import { Hono } from 'hono'
import { supabase } from '../db/supabase.js'
import { logger } from '../lib/logger.js'
import pkg from '../../package.json' with { type: 'json' }

export const statusRoutes = new Hono()

/**
 * GET /v1/status — Public status endpoint.
 * Returns API version, uptime, and dependency health.
 * No auth required — used by monitoring tools, Docker healthcheck, and dashboards.
 */
statusRoutes.get('/status', async (c) => {
  // Check Supabase connectivity
  let dbOk = false
  try {
    const { error } = await supabase.from('tenants').select('id', { count: 'exact', head: true }).limit(1)
    dbOk = !error
  } catch { /* db unreachable */ }

  // Check Stripe configuration (not connectivity — just if configured)
  const stripeConfigured = !!process.env.STRIPE_SECRET_KEY

  return c.json({
    service: 'TenantScale API',
    version: pkg.version ?? '0.1.0',
    mode: process.env.DEPLOYMENT_MODE ?? 'self_hosted',
    uptime: Math.floor(process.uptime()),
    database: dbOk ? 'connected' : 'unreachable',
    stripe: stripeConfigured ? 'configured' : 'not_configured',
    timestamp: new Date().toISOString(),
  })
})
