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
//
// SECURITY: Only HMAC algorithms (HS256/384/512) are supported, and the
// token's `alg` header must EXACTLY match the configured AUTH_JWT_ALGORITHM.
// The adapter never treats an unverified token as valid: a token declaring a
// different alg (including `none`) is always rejected, and asymmetrically
// signed tokens (RS256/ES256) are not accepted without a proper verifier.
// ──────────────────────────────────────────────────────

import type { AuthAdapter, SessionUser, UserProfile } from './adapter.js'
import { createHmac, timingSafeEqual } from 'node:crypto'

interface JwtPayload {
  sub?: string
  email?: string
  [key: string]: unknown
}

/** Map an HS algorithm name to its Node hash. Returns null for anything else. */
function hmacHashFor(algorithm: string): 'sha256' | 'sha384' | 'sha512' | null {
  switch (algorithm) {
    case 'HS256': return 'sha256'
    case 'HS384': return 'sha384'
    case 'HS512': return 'sha512'
    default: return null
  }
}

/**
 * Decode and verify a JWT.
 *
 * Verification is driven ONLY by the configured AUTH_JWT_ALGORITHM — never by
 * the (attacker-controlled) token header. The token must declare exactly the
 * configured algorithm and its signature is always checked with a
 * constant-time comparison. Anything else fails closed (returns null).
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

    const configuredAlg = (process.env.AUTH_JWT_ALGORITHM ?? 'HS256').toUpperCase()

    // Only HMAC is supported. If a non-HMAC algorithm is configured there is no
    // secret-based verification available, so fail closed instead of accepting
    // unverified asymmetric tokens.
    const hashAlgo = hmacHashFor(configuredAlg)
    if (!hashAlgo) {
      throw new Error(
        `AUTH_JWT_ALGORITHM=${configuredAlg} is not supported. Only HS256, HS384 and HS512 are supported.`,
      )
    }

    // The token MUST declare exactly the configured algorithm. This blocks
    // `alg: none` and algorithm-confusion downgrades (e.g. RS256 signed with an
    // HMAC secret).
    const tokenAlg = header.alg?.toUpperCase()
    if (tokenAlg !== configuredAlg) {
      return null
    }

    const expectedSig = createHmac(hashAlgo, secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest()

    const actualSig = Buffer.from(signatureB64, 'base64url')

    // Constant-time comparison; guard the length so mismatched-length inputs
    // can't leak anything and can't pass.
    if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
      return null
    }

    // Decode and validate payload
    const payload: JwtPayload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8'),
    )

    // A session token must carry a subject.
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null
    // Reject expired tokens, and treat malformed/missing exp or nbf as invalid.
    if (typeof payload.exp === 'number' && Date.now() / 1000 >= payload.exp) return null
    if (typeof payload.nbf === 'number' && Date.now() / 1000 < payload.nbf) return null

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