import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { jwtAuthAdapter } from '../jwt-adapter.js'

const SECRET = 'test-shared-secret'

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

/**
 * Build a signed JWT. `alg` controls BOTH the header value and the signature
 * algorithm so tests can exercise mismatches and forgeries.
 */
function makeToken(
  payload: Record<string, unknown>,
  alg: string,
  secret: string = SECRET,
): string {
  const header = b64url(JSON.stringify({ alg, typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const hash = alg === 'HS384' ? 'sha384' : alg === 'HS512' ? 'sha512' : 'sha256'
  const sig = createHmac(hash, secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { sub: 'user-123', email: 'a@b.com', iat: Math.floor(Date.now() / 1000) - 100, ...overrides }
}

describe('jwtAuthAdapter (HS256 configured)', () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = SECRET
    process.env.AUTH_JWT_ALGORITHM = 'HS256'
  })
  afterEach(() => {
    delete process.env.AUTH_JWT_SECRET
    delete process.env.AUTH_JWT_ALGORITHM
  })

  it('accepts a valid, correctly-signed HS256 token', async () => {
    const result = await jwtAuthAdapter.validateSession(makeToken(validPayload(), 'HS256'))
    expect(result).toEqual({ id: 'user-123', email: 'a@b.com' })
  })

  it('REJECTS an `alg: none` token (signature bypass)', async () => {
    // Header declares alg:none — must NOT be treated as valid.
    const token = makeToken(validPayload(), 'none')
    const result = await jwtAuthAdapter.validateSession(token)
    expect(result).toBeNull()
  })

  it('REJECTS algorithm-confusion: RS256 token signed with the HS secret', async () => {
    // Old code skipped verification whenever header.alg wasn't "HS*".
    const token = makeToken(validPayload(), 'RS256')
    const result = await jwtAuthAdapter.validateSession(token)
    expect(result).toBeNull()
  })

  it('REJECTS a token declaring a different HMAC alg than configured (HS384)', async () => {
    const token = makeToken(validPayload(), 'HS384')
    const result = await jwtAuthAdapter.validateSession(token)
    expect(result).toBeNull()
  })

  it('REJECTS a token signed with the wrong secret', async () => {
    const token = makeToken(validPayload(), 'HS256', 'different-secret')
    const result = await jwtAuthAdapter.validateSession(token)
    expect(result).toBeNull()
  })

  it('REJECTS a tampered payload (signature over the original body no longer matches)', async () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    // Signature is computed over the ORIGINAL (user-123) body…
    const signedBody = b64url(JSON.stringify(validPayload({ sub: 'user-123' })))
    const sig = createHmac('sha256', SECRET)
      .update(`${header}.${signedBody}`)
      .digest('base64url')
    // …but an attacker presents a body claiming a DIFFERENT subject.
    const tamperedBody = b64url(JSON.stringify(validPayload({ sub: 'user-999' })))
    const token = `${header}.${tamperedBody}.${sig}`
    const result = await jwtAuthAdapter.validateSession(token)
    expect(result).toBeNull()
  })

  it('REJECTS an expired token', async () => {
    const token = makeToken(validPayload({ exp: Math.floor(Date.now() / 1000) - 10 }), 'HS256')
    const result = await jwtAuthAdapter.validateSession(token)
    expect(result).toBeNull()
  })

  it('REJECTS a token with no subject', async () => {
    const payload = validPayload()
    delete payload.sub
    const token = makeToken(payload, 'HS256')
    const result = await jwtAuthAdapter.validateSession(token)
    expect(result).toBeNull()
  })

  it('REJECTS a malformed token (wrong segment count)', async () => {
    const result = await jwtAuthAdapter.validateSession('a.b')
    expect(result).toBeNull()
  })
})

describe('jwtAuthAdapter (configured algorithm governs)', () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = SECRET
  })
  afterEach(() => {
    delete process.env.AUTH_JWT_SECRET
    delete process.env.AUTH_JWT_ALGORITHM
  })

  it('accepts an HS384 token when HS384 is configured', async () => {
    process.env.AUTH_JWT_ALGORITHM = 'HS384'
    const result = await jwtAuthAdapter.validateSession(makeToken(validPayload(), 'HS384'))
    expect(result).toEqual({ id: 'user-123', email: 'a@b.com' })
  })

  it('rejects an HS256 token when HS384 is configured', async () => {
    process.env.AUTH_JWT_ALGORITHM = 'HS384'
    const result = await jwtAuthAdapter.validateSession(makeToken(validPayload(), 'HS256'))
    expect(result).toBeNull()
  })

  it('fails closed (rejects everything) when a non-HMAC algorithm is configured', async () => {
    process.env.AUTH_JWT_ALGORITHM = 'RS256'
    const result = await jwtAuthAdapter.validateSession(makeToken(validPayload(), 'RS256'))
    expect(result).toBeNull()
  })
})

describe('jwtAuthAdapter (missing config)', () => {
  it('rejects when AUTH_JWT_SECRET is not set', async () => {
    delete process.env.AUTH_JWT_SECRET
    const result = await jwtAuthAdapter.validateSession(makeToken(validPayload(), 'HS256'))
    expect(result).toBeNull()
  })
})