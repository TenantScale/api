// ──────────────────────────────────────────────────────
// Auth factory — resolves the active auth adapter
// ──────────────────────────────────────────────────────

import type { AuthAdapter } from './adapter.js'

const adapters = new Map<string, AuthAdapter>()

export function registerAdapter(name: string, adapter: AuthAdapter) {
  adapters.set(name, adapter)
}

export function getAdapter(name?: string): AuthAdapter {
  const key = name ?? process.env.AUTH_ADAPTER ?? 'supabase'
  const adapter = adapters.get(key)
  if (!adapter) {
    throw new Error(
      `Unknown auth adapter "${key}". Available: ${[...adapters.keys()].join(', ')}`,
    )
  }
  return adapter
}

// ── Self-registering adapters ──
// These are imported here so they register themselves at module load time.
// We avoid circular deps by keeping adapter.ts purely as interfaces.
import { supabaseAuthAdapter } from './supabase-adapter.js'
import { jwtAuthAdapter } from './jwt-adapter.js'

registerAdapter('supabase', supabaseAuthAdapter)
registerAdapter('jwt', jwtAuthAdapter)
