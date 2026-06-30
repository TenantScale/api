// ──────────────────────────────────────────────────────
// TenantScale API — Local Dev Server Entry
// ──────────────────────────────────────────────────────
import 'dotenv/config'
import { serve } from '@hono/node-server'
import pino from 'pino'
import app from './app'

const port = parseInt(process.env.PORT ?? '3001')

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// Validate required environment variables at startup
const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const
const missing = requiredVars.filter(v => !process.env[v])
if (missing.length > 0) {
  logger.fatal({ missing }, 'Missing required environment variables')
  console.error(`[TenantScale] Missing required env vars: ${missing.join(', ')}`)
  console.error('[TenantScale] Set them in .env or the environment before starting.')
  process.exit(1)
}

const server = serve({
  fetch: app.fetch,
  port,
}, (info) => {
  logger.info({ port: info.port }, 'API server started')
})

process.on('SIGTERM', () => { server.close(); process.exit(0) })
process.on('SIGINT', () => { server.close(); process.exit(0) })

export default app
