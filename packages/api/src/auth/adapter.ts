// ──────────────────────────────────────────────────────
// Auth Adapter — abstract identity provider interface
// ──────────────────────────────────────────────────────
// Allows TenantScale to work with any auth provider:
//   - supabase (default) — uses Supabase Auth
//   - jwt — validates BYO JWT against a shared secret
//
// Selected via AUTH_ADAPTER=*** ────────────────────────

export interface AuthAdapter {
  /** Validate a session token and return the user identity */
  validateSession(token: string): Promise<SessionUser | null>

  /** Create a new user account with email + password */
  createUser(email: string, password: string): Promise<SessionUser>

  /** Sign in with email + password and return a session token */
  signIn(email: string, password: string): Promise<{ sessionToken: string; user: SessionUser } | null>

  /** Look up a user's profile by their user ID */
  getUserProfile(userId: string): Promise<UserProfile | null>
}

export interface SessionUser {
  id: string
  email: string
}

export interface UserProfile {
  id: string
  email: string
}
