// ──────────────────────────────────────────────────────
// Supabase Auth Adapter
// ──────────────────────────────────────────────────────
// Wraps Supabase Auth API calls behind the AuthAdapter interface.
// This is the default adapter used by TenantScale.

import type { AuthAdapter, SessionUser, UserProfile } from './adapter.js'
import { supabase } from '../db/supabase.js'

export const supabaseAuthAdapter: AuthAdapter = {
  async validateSession(token: string): Promise<SessionUser | null> {
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return null
    return { id: user.id, email: user.email ?? '' }
  },

  async createUser(email: string, password: string): Promise<SessionUser> {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error || !data.user) {
      throw new Error(error?.message ?? 'Failed to create user')
    }
    return { id: data.user.id, email: data.user.email ?? email }
  },

  async signIn(email: string, password: string): Promise<{ sessionToken: string; user: SessionUser } | null> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) return null
    return {
      sessionToken: data.session.access_token,
      user: { id: data.user.id, email: data.user.email ?? '' },
    }
  },

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (error || !data?.user) return null
    return { id: data.user.id, email: data.user.email ?? '' }
  },
}
