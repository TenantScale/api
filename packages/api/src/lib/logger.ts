// ──────────────────────────────────────────────────────
// Shared structured logger
// ──────────────────────────────────────────────────────

import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.VERCEL
    ? {}
    : { transport: { target: 'pino/file' } }),
})
