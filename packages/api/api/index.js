// ──────────────────────────────────────────────────────
// TenantScale API — Vercel Serverless Entry Point
// ──────────────────────────────────────────────────────
// .js file (not .ts) so Vercel passes it through directly
// without esbuild stripping .js extensions from imports.

import app from './bundle.js'

export default app.fetch
