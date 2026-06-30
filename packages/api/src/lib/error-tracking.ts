// ──────────────────────────────────────────────────────
// TenantScale — Sentry Error Tracking Integration
// ──────────────────────────────────────────────────────
// Optional Sentry integration — gracefully no‑ops when:
//   - SENTRY_DSN is not set in the environment
//   - @sentry/node is not installed
// ──────────────────────────────────────────────────────

import { logger } from './logger'

let sentryEnabled = false

/**
 * Initialise Sentry at startup.  Safe to call even when
 * Sentry is not configured or installed.
 */
export async function initSentry(): Promise<void> {
  if (!process.env.SENTRY_DSN) {
    logger.info('Sentry not configured — skipping error tracking setup')
    return
  }

  try {
    const Sentry = await import('@sentry/node')
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.DEPLOYMENT_MODE ?? 'development',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    })
    sentryEnabled = true
    logger.info(
      { dsn: process.env.SENTRY_DSN.slice(0, 25) + '...' },
      'Sentry initialised',
    )
  } catch (err) {
    logger.warn({ err }, 'Failed to init Sentry — @sentry/node may not be installed')
  }
}

/**
 * Capture an exception and send it to Sentry.
 * No‑op when Sentry is not enabled.
 */
export function captureException(
  err: Error,
  context?: Record<string, unknown>,
): void {
  if (!sentryEnabled) return

  import('@sentry/node')
    .then((Sentry) => {
      Sentry.withScope((scope) => {
        if (context) scope.setExtras(context)
        Sentry.captureException(err)
      })
    })
    .catch(() => {
      // silent — Sentry was enabled at init but import failed at runtime
    })
}

/** Whether Sentry error tracking is currently active */
export function isSentryEnabled(): boolean {
  return sentryEnabled
}
