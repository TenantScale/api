// ──────────────────────────────────────────────────────
// TenantScale API — Local Dev Server Entry
// ──────────────────────────────────────────────────────
import 'dotenv/config'
import { serve } from '@hono/node-server'
import app from './app.js'
import { initSentry, closeSentry } from './lib/error-tracking.js'
import { logger } from './lib/logger.js'

const port = parseInt(process.env.PORT ?? '3001')

/** Max ms to wait for in-flight requests before forced exit (configurable via env) */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT ?? '30000')

// Validate required environment variables at startup
const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const
const missing = requiredVars.filter(v => !process.env[v])
if (missing.length > 0) {
  logger.fatal({ missing }, 'Missing required environment variables')
  console.error(`[TenantScale] Missing required env vars: ${missing.join(', ')}`)
  console.error('[TenantScale] Set them in .env or the environment before starting.')
  process.exit(1)
}

// ── Initialise error tracking (Sentry) — optional, no crash if unconfigured ──
initSentry().then(() => {
  logger.info('Error tracking initialised')
}).catch((err) => {
  logger.warn({ err }, 'Error tracking setup skipped')
})

let shuttingDown = false
let closeError: Error | null = null

async function gracefulShutdown(signal: string): Promise<boolean> {
  if (shuttingDown) return false
  shuttingDown = true

  logger.info({ signal }, 'Shutdown signal received — starting graceful shutdown')

  // Force exit if graceful shutdown takes too long
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit')
    process.exit(1)
  }, GRACEFUL_SHUTDOWN_TIMEOUT_MS)

  // Stop accepting new connections and drain in-flight requests
  await new Promise<void>((resolve) => {
    server.close((err?: Error) => {
      if (err) {
        closeError = err
        logger.error({ err }, 'Error during HTTP server close')
      } else {
        logger.info('HTTP server stopped accepting new connections')
      }
      resolve()
    })
  })

  clearTimeout(forceExit)

  // Flush Sentry events before exiting
  await closeSentry()

  logger.info('Graceful shutdown complete')
  return true
}

const server = serve({
  fetch: app.fetch,
  port,
}, (info) => {
  logger.info({ port: info.port }, 'API server started')
})

process.on('SIGTERM', async () => {
  await gracefulShutdown('SIGTERM')
  process.exit(closeError ? 1 : 0)
})

process.on('SIGINT', async () => {
  await gracefulShutdown('SIGINT')
  process.exit(closeError ? 1 : 0)
})

export default app
