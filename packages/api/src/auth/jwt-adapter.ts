// ──────────────────────────────────────────────────────
// JWT Auth Adapter
// ──────────────────────────────────────────────────────
// Validates a BYO JWT against a shared secret.
// For developers who already have their own auth system
// (Auth0, Clerk, Firebase, custom) and want to use it
// with TenantScale's portal.
//
// The developer's auth system must issue JWTs with:
//   sub: user_id (string)
//   email: user_email (string)
//
// Configure via:
//   AUTH_ADAPTER=jwt
//   AUTH_JWT_SECRET=your-shared-secret
//   AUTH_JWT_ALGORITHM=HS256 (default)

import type { AuthAdapter, SessionUser, UserProfile } from './adapter.js'
import { createHash, createHmac } from 'node:crypto'

interface JwtPayload {
  sub?: string
  email?: string
  [key: string]: unknown
}

/**
 * Minimal JWT decoder — no external dependency.
 * Verifies HS256/HS384/HS512 signatures. For RS256/ES256,
 * just decodes the payload without verification.
 */
function decodeAndVerify(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts

    let header: { alg?: string; typ?: string }
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'))
    } catch {
      return null
    }

    const secret = process.env.AUTH_JWT_SECRET
    if (!secret) {
      throw new Error('AUTH_JWT_SECRET is required when using jwt auth adapter')
    }

    const algorithm = process.env.AUTH_JWT_ALGORITHM ?? 'HS256'

    // For non-HMAC algorithms, just decode without verification
    if (header.alg && !header.alg.startsWith('HS')) {
      return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'))
    }

    let hashAlgo: string
    switch (algorithm) {
      case 'HS256': hashAlgo = 'sha256'; break
      case 'HS384': hashAlgo = 'sha384'; break
      case 'HS512': hashAlgo = 'sha512'; break
      default: return null
    }

    const expectedSig = createHmac(hashAlgo, secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest()

    const actualSig = Buffer.from(signatureB64, 'base64url')

    // Constant-time comparison
    const expectedHash = createHash(hashAlgo).update(expectedSig).digest()
    const actualHash = createHash(hashAlgo).update(actualSig).digest()
    if (!expectedHash.equals(actualHash)) return null

    // Decode and validate payload
    const payload: JwtPayload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8'),
    )

    if (payload.exp && Date.now() / 1000 > (payload.exp as number)) return null
    if (payload.nbf && Date.now() / 1000 < (payload.nbf as number)) return null

    return payload
  } catch {
    return null
  }
}

export const jwtAuthAdapter: AuthAdapter = {
  async validateSession(token: string): Promise<SessionUser | null> {
    const payload = decodeAndVerify(token)
    if (!payload || !payload.sub) return null
    return {
      id: payload.sub,
      email: payload.email ?? '',
    }
  },

  async createUser(_email: string, _password: string): Promise<SessionUser> {
    throw new Error(
      'User creation is not supported with the JWT auth adapter. ' +
      'Users must be created in your own auth system.',
    )
  },

  async signIn(_email: string, _password: string): Promise<{ sessionToken: string; user: SessionUser } | null> {
    throw new Error(
      'Sign-in is not supported with the JWT auth adapter. ' +
      'Users must sign in through your own auth system.',
    )
  },

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    // Without a user DB, return a minimal profile
    return { id: userId, email: `user_${userId}@unknown` }
  },
}
