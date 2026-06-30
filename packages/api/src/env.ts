// ──────────────────────────────────────────────────────
// Hono context type extensions
// ──────────────────────────────────────────────────────

export interface ApiKeyContext {
  raw: string
  tenant_id: string
  scopes: string[]
  created_by: string | null
}

declare module 'hono' {
  interface ContextVariableMap {
    apiKey: ApiKeyContext
    requestId: string
  }
}
