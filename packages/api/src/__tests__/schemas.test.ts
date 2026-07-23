// ──────────────────────────────────────────────────────
// TenantScale API — Exhaustive Zod Schema Tests
// ──────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  createTenantSchema,
  updateTenantSchema,
  createApiKeySchema,
  updatePlanSchema,
  createAuditEventSchema,
  inviteUserSchema,
  updateRoleSchema,
  transferOwnershipSchema,
  createImpersonationSchema,
  updateSettingsSchema,
  registerSchema,
  portalTenantCreateSchema,
  trackEventSchema,
  createPortalApiKeySchema,
  ssrfUrlCheck,
} from '../routes/schemas.js'

// ════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════

function assertParseError(e: unknown, expectedField?: string): void {
  expect(e).toBeInstanceOf(Error)
  if (e instanceof Error) {
    expect(typeof e.message).toBe('string')
    expect(e.message.length).toBeGreaterThan(0)
    if (expectedField) {
      expect(e.message.toLowerCase()).toContain(expectedField.toLowerCase())
    }
  }
}

// ════════════════════════════════════════════════════════════════
// ssrfUrlCheck
// ════════════════════════════════════════════════════════════════

describe('ssrfUrlCheck', () => {
  // ── Happy Path ──
  it('allows valid HTTPS URL', () => {
    expect(ssrfUrlCheck('https://api.example.com/webhook')).toBe(true)
  })

  it('allows valid HTTP URL', () => {
    expect(ssrfUrlCheck('http://example.com/hook')).toBe(true)
  })

  it('allows public IP 8.8.8.8', () => {
    expect(ssrfUrlCheck('http://8.8.8.8/')).toBe(true)
  })

  // ── Unhappy Path ──
  it('rejects invalid URL string', () => {
    expect(ssrfUrlCheck('not-a-url')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(ssrfUrlCheck('')).toBe(false)
  })

  it('rejects localhost hostname', () => {
    expect(ssrfUrlCheck('http://localhost:3000/webhook')).toBe(false)
  })

  it('rejects 127.0.0.1 IP', () => {
    expect(ssrfUrlCheck('http://127.0.0.1/api')).toBe(false)
  })

  it('rejects private IP 10.x.x.x', () => {
    expect(ssrfUrlCheck('http://10.0.0.1/hook')).toBe(false)
  })

  it('rejects private IP 10.x.x.x (deep range)', () => {
    expect(ssrfUrlCheck('http://10.255.255.255/test')).toBe(false)
  })

  it('rejects private IP 192.168.x.x', () => {
    expect(ssrfUrlCheck('http://192.168.1.1/hook')).toBe(false)
  })

  it('rejects 169.254.x.x link-local', () => {
    expect(ssrfUrlCheck('http://169.254.169.254/metadata')).toBe(false)
  })

  it('rejects 172.16-31.x.x private range', () => {
    expect(ssrfUrlCheck('http://172.16.0.1/test')).toBe(false)
    expect(ssrfUrlCheck('http://172.31.255.255/test')).toBe(false)
  })

  it('rejects non-HTTP protocol (ftp)', () => {
    expect(ssrfUrlCheck('ftp://files.example.com/data')).toBe(false)
  })

  it('rejects 0.0.0.0', () => {
    expect(ssrfUrlCheck('http://0.0.0.0/')).toBe(false)
  })

  it('rejects blocklisted hostnames (docker internal)', () => {
    expect(ssrfUrlCheck('http://host.docker.internal/api')).toBe(false)
  })

  it('rejects metadata.google.internal', () => {
    expect(ssrfUrlCheck('http://metadata.google.internal/')).toBe(false)
  })

  // ── Boundary / Edge Cases ──
  it('handles very long valid URL', () => {
    const longPath = 'a'.repeat(10000)
    expect(ssrfUrlCheck(`https://example.com/${longPath}`)).toBe(true)
  })

  it('handles Unicode URL', () => {
    // Unicode in host gets punycode-encoded by URL parser
    expect(ssrfUrlCheck('https://éxample.com/hook')).toBe(true)
  })

  it('rejects 100.x.x.x (Carrier-Grade NAT range)', () => {
    expect(ssrfUrlCheck('http://100.64.0.1/test')).toBe(false)
    expect(ssrfUrlCheck('http://100.127.255.255/test')).toBe(false)
  })

  it('rejects IP with invalid octet > 255', () => {
    expect(ssrfUrlCheck('http://999.999.999.999/')).toBe(false)
  })

  it('rejects null/undefined gracefully (coerces to string)', () => {
    // URL constructor would throw, caught by try/catch → false
    expect(ssrfUrlCheck(null as unknown as string)).toBe(false)
    expect(ssrfUrlCheck(undefined as unknown as string)).toBe(false)
  })

  it('allows public IP 203.0.113.5 (TEST-NET-3, considered public)', () => {
    expect(ssrfUrlCheck('http://203.0.113.5/')).toBe(true)
  })

  // ── Error Handling ──
  it('returns false (no throw) for malformed input', () => {
    // Tab character, newlines, etc. — URL parser throws and catch returns false
    expect(ssrfUrlCheck('http://\n')).toBe(false)
    expect(ssrfUrlCheck('http://')).toBe(false)
    expect(ssrfUrlCheck('://host')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════
// createTenantSchema
// ════════════════════════════════════════════════════════════════

describe('createTenantSchema', () => {
  // ── Happy Path ──
  it('parses valid tenant input', () => {
    const result = createTenantSchema.parse({ name: 'My Org', slug: 'my-org' })
    expect(result.name).toBe('My Org')
    expect(result.slug).toBe('my-org')
  })

  it('omits plan_id when not provided (optional field)', () => {
    const result = createTenantSchema.parse({ name: 'Test', slug: 'test' })
    expect(result.plan_id).toBeUndefined()
    expect(Object.keys(result)).not.toContain('plan_id')
  })

  it('accepts plan_id when provided', () => {
    const result = createTenantSchema.parse({ name: 'Pro Org', slug: 'pro-org', plan_id: 'pro' })
    expect(result.plan_id).toBe('pro')
  })

  it('accepts exactly minimum length name (1 char)', () => {
    const result = createTenantSchema.parse({ name: 'A', slug: 'ab' })
    expect(result.name).toBe('A')
  })

  it('accepts exactly maximum length name (100 chars)', () => {
    const name = 'a'.repeat(100)
    const result = createTenantSchema.parse({ name, slug: 'a-company' })
    expect(result.name).toBe(name)
  })

  it('accepts exactly minimum length slug (2 chars)', () => {
    const result = createTenantSchema.parse({ name: 'Test', slug: 'ab' })
    expect(result.slug).toBe('ab')
  })

  it('accepts exactly maximum length slug (50 chars)', () => {
    const slug = 'a'.repeat(50)
    const result = createTenantSchema.parse({ name: 'Test', slug })
    expect(result.slug).toBe(slug)
  })

  // ── Unhappy Path ──
  it('rejects missing name', () => {
    expect(() => createTenantSchema.parse({ slug: 'my-org' })).toThrow()
  })

  it('rejects missing slug', () => {
    expect(() => createTenantSchema.parse({ name: 'My Org' })).toThrow()
  })

  it('rejects empty name string', () => {
    expect(() => createTenantSchema.parse({ name: '', slug: 'my-org' })).toThrow()
  })

  it('rejects empty slug string', () => {
    expect(() => createTenantSchema.parse({ name: 'My Org', slug: '' })).toThrow()
  })

  it('rejects name exceeding max length (101 chars)', () => {
    expect(() => createTenantSchema.parse({ name: 'a'.repeat(101), slug: 'my-org' })).toThrow()
  })

  it('rejects slug exceeding max length (51 chars)', () => {
    expect(() => createTenantSchema.parse({ name: 'Test', slug: 'a'.repeat(51) })).toThrow()
  })

  it('rejects slug with uppercase letters (regex violation)', () => {
    expect(() => createTenantSchema.parse({ name: 'Test', slug: 'My-Org' })).toThrow()
  })

  it('rejects slug with spaces', () => {
    expect(() => createTenantSchema.parse({ name: 'Test', slug: 'my org' })).toThrow()
  })

  it('rejects slug with special characters', () => {
    expect(() => createTenantSchema.parse({ name: 'Test', slug: 'my_org!' })).toThrow()
  })

  it('rejects slug with underscores', () => {
    expect(() => createTenantSchema.parse({ name: 'Test', slug: 'my_org' })).toThrow()
  })

  it('rejects name as number (wrong type)', () => {
    expect(() => createTenantSchema.parse({ name: 123, slug: 'my-org' })).toThrow()
  })

  it('rejects slug as number (wrong type)', () => {
    expect(() => createTenantSchema.parse({ name: 'Test', slug: 123 })).toThrow()
  })

  it('rejects null name', () => {
    expect(() => createTenantSchema.parse({ name: null, slug: 'my-org' })).toThrow()
  })

  it('rejects undefined slug', () => {
    expect(() => createTenantSchema.parse({ name: 'Test', slug: undefined })).toThrow()
  })

  // ── Unicode / Injection ──
  it('accepts Unicode characters in name', () => {
    const result = createTenantSchema.parse({ name: 'Café Montréal 🏢', slug: 'cafe-mtl' })
    expect(result.name).toBe('Café Montréal 🏢')
  })

  it('rejects SQL injection in name (not a name-level rejection, just passes through)', () => {
    // Zod only validates min/max/type, not content — SQL injection strings are valid strings
    const result = createTenantSchema.parse({ name: "'; DROP TABLE tenants; --", slug: 'sql-attack' })
    expect(result.name).toBe("'; DROP TABLE tenants; --")
  })

  it('rejects SQL injection in slug (regex fails on special chars)', () => {
    expect(() => createTenantSchema.parse({ name: 'Test', slug: "';drop--" })).toThrow()
  })

  it('rejects HTML tags in slug (regex fails)', () => {
    expect(() => createTenantSchema.parse({ name: 'Test', slug: '<script>' })).toThrow()
  })

  it('passes HTML tags in name (name has no regex, only length check)', () => {
    const result = createTenantSchema.parse({ name: '<b>Bold</b>', slug: 'bold-name' })
    expect(result.name).toBe('<b>Bold</b>')
  })

  // ── Error Handling ──
  it('produces readable error for missing name', () => {
    try { createTenantSchema.parse({ slug: 'test' }) }
    catch (e) { assertParseError(e, 'name') }
  })

  it('produces readable error for invalid slug regex', () => {
    try { createTenantSchema.parse({ name: 'Test', slug: 'BAD' }) }
    catch (e) {
      assertParseError(e)
      if (e instanceof Error) {
        expect(e.message).toContain('lowercase')
      }
    }
  })
})

// ════════════════════════════════════════════════════════════════
// updateTenantSchema
// ════════════════════════════════════════════════════════════════

describe('updateTenantSchema', () => {
  // ── Happy Path ──
  it('parses empty object (all fields optional)', () => {
    const result = updateTenantSchema.parse({})
    expect(result).toEqual({})
  })

  it('parses with all fields provided', () => {
    const result = updateTenantSchema.parse({
      name: 'Updated Name',
      is_active: false,
      plan_id: 'pro',
      features: { max_users: 50 },
      config: { region: 'us-east' },
      settings: { theme: 'dark' },
      metadata: { created_by: 'admin' },
    })
    expect(result.name).toBe('Updated Name')
    expect(result.is_active).toBe(false)
    expect(result.plan_id).toBe('pro')
  })

  it('accepts single field update', () => {
    const result = updateTenantSchema.parse({ name: 'Just Name' })
    expect(result.name).toBe('Just Name')
    expect(Object.keys(result)).toHaveLength(1)
  })

  // ── Unhappy Path ──
  it('rejects name shorter than 1', () => {
    expect(() => updateTenantSchema.parse({ name: '' })).toThrow()
  })

  it('rejects name longer than 100', () => {
    expect(() => updateTenantSchema.parse({ name: 'a'.repeat(101) })).toThrow()
  })

  it('rejects is_active as string', () => {
    expect(() => updateTenantSchema.parse({ is_active: 'yes' })).toThrow()
  })

  it('rejects plan_id as number', () => {
    expect(() => updateTenantSchema.parse({ plan_id: 42 })).toThrow()
  })

  it('rejects features as string', () => {
    expect(() => updateTenantSchema.parse({ features: 'not-a-record' })).toThrow()
  })

  it('rejects config as array', () => {
    expect(() => updateTenantSchema.parse({ config: [1, 2, 3] })).toThrow()
  })

  // ── Boundary ──
  it('accepts name exactly at max length', () => {
    const name = 'a'.repeat(100)
    const result = updateTenantSchema.parse({ name })
    expect(result.name).toBe(name)
  })

  it('accepts is_active as true', () => {
    const result = updateTenantSchema.parse({ is_active: true })
    expect(result.is_active).toBe(true)
  })

  // ── Unicode ──
  it('accepts Unicode in name', () => {
    const result = updateTenantSchema.parse({ name: '日本語のテナント' })
    expect(result.name).toBe('日本語のテナント')
  })

  // ── Injection ──
  it('accepts SQL-like string in name (valid string)', () => {
    const result = updateTenantSchema.parse({ name: "1; SELECT * FROM tenants; --" })
    expect(result.name).toBe("1; SELECT * FROM tenants; --")
  })

  // ── Error Handling ──
  it('produces readable error for invalid field type', () => {
    try { updateTenantSchema.parse({ is_active: 'nope' }) }
    catch (e) { assertParseError(e, 'is_active') }
  })
})

// ════════════════════════════════════════════════════════════════
// createApiKeySchema
// ════════════════════════════════════════════════════════════════

describe('createApiKeySchema', () => {
  // ── Happy Path ──
  it('parses with only label (scopes get default)', () => {
    const result = createApiKeySchema.parse({ label: 'My API Key' })
    expect(result.label).toBe('My API Key')
    expect(result.scopes).toEqual(['read', 'write'])
  })

  it('parses with custom scopes', () => {
    const result = createApiKeySchema.parse({ label: 'Read Only', scopes: ['read'] })
    expect(result.scopes).toEqual(['read'])
  })

  it('accepts label at minimum length (1 char)', () => {
    const result = createApiKeySchema.parse({ label: 'K' })
    expect(result.label).toBe('K')
  })

  it('accepts label at maximum length (100 chars)', () => {
    const label = 'a'.repeat(100)
    const result = createApiKeySchema.parse({ label })
    expect(result.label).toBe(label)
  })

  // ── Unhappy Path ──
  it('rejects missing label', () => {
    expect(() => createApiKeySchema.parse({})).toThrow()
  })

  it('rejects empty label string', () => {
    expect(() => createApiKeySchema.parse({ label: '' })).toThrow()
  })

  it('rejects label exceeding 100 chars', () => {
    expect(() => createApiKeySchema.parse({ label: 'a'.repeat(101) })).toThrow()
  })

  it('rejects label as number', () => {
    expect(() => createApiKeySchema.parse({ label: 123 })).toThrow()
  })

  it('rejects scopes as string (not array)', () => {
    expect(() => createApiKeySchema.parse({ label: 'Key', scopes: 'read' })).toThrow()
  })

  it('rejects null label', () => {
    expect(() => createApiKeySchema.parse({ label: null })).toThrow()
  })

  // ── Unicode ──
  it('accepts Unicode in label', () => {
    const result = createApiKeySchema.parse({ label: '🔑 API Key for Café' })
    expect(result.label).toBe('🔑 API Key for Café')
  })

  // ── Injection ──
  it('accepts HTML in label (string is valid)', () => {
    const result = createApiKeySchema.parse({ label: '<script>alert("xss")</script>' })
    expect(result.label).toBe('<script>alert("xss")</script>')
  })

  // ── Error Handling ──
  it('produces readable error for missing label', () => {
    try { createApiKeySchema.parse({ scopes: ['read'] }) }
    catch (e) { assertParseError(e, 'label') }
  })
})

// ════════════════════════════════════════════════════════════════
// updatePlanSchema
// ════════════════════════════════════════════════════════════════

describe('updatePlanSchema', () => {
  // ── Happy Path ──
  it('parses empty object (all fields optional)', () => {
    const result = updatePlanSchema.parse({})
    expect(result).toEqual({})
  })

  it('parses with all fields', () => {
    const result = updatePlanSchema.parse({
      name: 'Pro Plan',
      description: 'For professionals',
      price_monthly: 2999,
      features: { api_calls: 50000, support: 'priority' },
      max_users: 10,
      sort_order: 1,
    })
    expect(result.name).toBe('Pro Plan')
    expect(result.price_monthly).toBe(2999)
    expect(result.sort_order).toBe(1)
  })

  it('accepts max_users as null (nullable)', () => {
    const result = updatePlanSchema.parse({ max_users: null })
    expect(result.max_users).toBeNull()
  })

  it('accepts price_monthly as 0 (minimum)', () => {
    const result = updatePlanSchema.parse({ price_monthly: 0 })
    expect(result.price_monthly).toBe(0)
  })

  // ── Unhappy Path ──
  it('rejects name as number', () => {
    expect(() => updatePlanSchema.parse({ name: 123 })).toThrow()
  })

  it('rejects price_monthly as float (expected int)', () => {
    expect(() => updatePlanSchema.parse({ price_monthly: 29.99 })).toThrow()
  })

  it('rejects price_monthly negative', () => {
    expect(() => updatePlanSchema.parse({ price_monthly: -1 })).toThrow()
  })

  it('rejects max_users as string', () => {
    expect(() => updatePlanSchema.parse({ max_users: 'ten' })).toThrow()
  })

  it('rejects sort_order as string', () => {
    expect(() => updatePlanSchema.parse({ sort_order: 'first' })).toThrow()
  })

  it('rejects features as array', () => {
    expect(() => updatePlanSchema.parse({ features: ['a', 'b'] })).toThrow()
  })

  // ── Boundary ──
  it('accepts price_monthly as very large integer', () => {
    const result = updatePlanSchema.parse({ price_monthly: 999999999 })
    expect(result.price_monthly).toBe(999999999)
  })

  it('accepts description with empty string (no min constraint)', () => {
    const result = updatePlanSchema.parse({ description: '' })
    expect(result.description).toBe('')
  })

  // ── Unicode / Injection ──
  it('accepts Unicode in name', () => {
    const result = updatePlanSchema.parse({ name: 'Plan プロ' })
    expect(result.name).toBe('Plan プロ')
  })

  // ── Error Handling ──
  it('produces readable error for wrong price_monthly type', () => {
    try { updatePlanSchema.parse({ price_monthly: 'free' }) }
    catch (e) { assertParseError(e, 'price_monthly') }
  })
})

// ════════════════════════════════════════════════════════════════
// createAuditEventSchema
// ════════════════════════════════════════════════════════════════

describe('createAuditEventSchema', () => {
  // ── Happy Path ──
  it('parses valid audit event', () => {
    const result = createAuditEventSchema.parse({
      action: 'tenant.created',
      resource: 'tenants/t1',
    })
    expect(result.action).toBe('tenant.created')
    expect(result.resource).toBe('tenants/t1')
    expect(result.details).toEqual({})
    expect(result.actor_id).toBeUndefined()
  })

  it('applies default empty details when omitted', () => {
    const result = createAuditEventSchema.parse({ action: 'user.login', resource: 'users/u1' })
    expect(result.details).toEqual({})
  })

  it('parses with optional actor_id (valid UUID)', () => {
    const result = createAuditEventSchema.parse({
      action: 'user.invited',
      resource: 'users/u1',
      actor_id: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.actor_id).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('parses with custom details', () => {
    const result = createAuditEventSchema.parse({
      action: 'plan.updated',
      resource: 'plans/pro',
      details: { old_price: 1999, new_price: 2999 },
    })
    expect(result.details.old_price).toBe(1999)
  })

  // ── Unhappy Path ──
  it('rejects missing action', () => {
    expect(() => createAuditEventSchema.parse({ resource: 'test' })).toThrow()
  })

  it('rejects missing resource', () => {
    expect(() => createAuditEventSchema.parse({ action: 'test' })).toThrow()
  })

  it('rejects empty action', () => {
    expect(() => createAuditEventSchema.parse({ action: '', resource: 'test' })).toThrow()
  })

  it('rejects empty resource', () => {
    expect(() => createAuditEventSchema.parse({ action: 'test', resource: '' })).toThrow()
  })

  it('rejects action exceeding 200 chars', () => {
    expect(() => createAuditEventSchema.parse({ action: 'a'.repeat(201), resource: 'test' })).toThrow()
  })

  it('rejects resource exceeding 500 chars', () => {
    expect(() => createAuditEventSchema.parse({ action: 'test', resource: 'a'.repeat(501) })).toThrow()
  })

  it('rejects action as number', () => {
    expect(() => createAuditEventSchema.parse({ action: 123, resource: 'test' })).toThrow()
  })

  it('rejects actor_id with invalid UUID', () => {
    expect(() => createAuditEventSchema.parse({
      action: 'test', resource: 'test', actor_id: 'not-a-uuid',
    })).toThrow()
  })

  it('rejects null action', () => {
    expect(() => createAuditEventSchema.parse({ action: null, resource: 'test' })).toThrow()
  })

  // ── Boundary ──
  it('accepts action at 200 chars', () => {
    const result = createAuditEventSchema.parse({ action: 'a'.repeat(200), resource: 'r' })
    expect(result.action).toBe('a'.repeat(200))
  })

  it('accepts resource at 500 chars', () => {
    const result = createAuditEventSchema.parse({ action: 'a', resource: 'r'.repeat(500) })
    expect(result.resource).toBe('r'.repeat(500))
  })

  // ── Unicode ──
  it('accepts Unicode in action and resource', () => {
    const result = createAuditEventSchema.parse({
      action: 'ユーザー作成',
      resource: 'テナント/123',
    })
    expect(result.action).toBe('ユーザー作成')
    expect(result.resource).toBe('テナント/123')
  })

  // ── Injection ──
  it('accepts SQL in action string', () => {
    const result = createAuditEventSchema.parse({
      action: "'; DELETE FROM audit_log; --",
      resource: 'test',
    })
    expect(result.action).toBe("'; DELETE FROM audit_log; --")
  })

  // ── Error Handling ──
  it('produces readable error for missing action', () => {
    try { createAuditEventSchema.parse({ resource: 'test' }) }
    catch (e) { assertParseError(e, 'action') }
  })
})

// ════════════════════════════════════════════════════════════════
// inviteUserSchema
// ════════════════════════════════════════════════════════════════

describe('inviteUserSchema', () => {
  // ── Happy Path ──
  it('parses valid invite with email only (role defaults to member)', () => {
    const result = inviteUserSchema.parse({ email: 'user@example.com' })
    expect(result.email).toBe('user@example.com')
    expect(result.role).toBe('member')
  })

  it('parses with custom role', () => {
    const result = inviteUserSchema.parse({ email: 'admin@example.com', role: 'admin' })
    expect(result.role).toBe('admin')
  })

  // ── Unhappy Path ──
  it('rejects missing email', () => {
    expect(() => inviteUserSchema.parse({ role: 'admin' })).toThrow()
  })

  it('rejects invalid email format', () => {
    expect(() => inviteUserSchema.parse({ email: 'not-an-email' })).toThrow()
  })

  it('rejects email without domain', () => {
    expect(() => inviteUserSchema.parse({ email: 'user@' })).toThrow()
  })

  it('rejects empty email', () => {
    expect(() => inviteUserSchema.parse({ email: '' })).toThrow()
  })

  it('rejects email as number', () => {
    expect(() => inviteUserSchema.parse({ email: 123 })).toThrow()
  })

  it('rejects null email', () => {
    expect(() => inviteUserSchema.parse({ email: null })).toThrow()
  })

  it('rejects role as empty string', () => {
    expect(() => inviteUserSchema.parse({ email: 'a@b.com', role: '' })).toThrow()
  })

  // ── Unicode ──
  it('accepts email with international characters (punycode encoded domain)', () => {
    // Zod's .email() validates RFC 5322; internationalized domains must use punycode
    const result = inviteUserSchema.parse({ email: 'test@xn--xample-9ua.com' })
    expect(result.email).toBe('test@xn--xample-9ua.com')
  })

  // ── Injection ──
  it('rejects email with SQL injection (invalid email format)', () => {
    expect(() => inviteUserSchema.parse({ email: "'; DROP TABLE users; --" })).toThrow()
  })

  it('accepts email with plus addressing', () => {
    const result = inviteUserSchema.parse({ email: 'user+tag@example.com' })
    expect(result.email).toBe('user+tag@example.com')
  })

  // ── Error Handling ──
  it('produces readable error for invalid email', () => {
    try { inviteUserSchema.parse({ email: 'invalid' }) }
    catch (e) { assertParseError(e, 'email') }
  })
})

// ════════════════════════════════════════════════════════════════
// updateRoleSchema
// ════════════════════════════════════════════════════════════════

describe('updateRoleSchema', () => {
  // ── Happy Path ──
  it('parses valid role', () => {
    const result = updateRoleSchema.parse({ role: 'admin' })
    expect(result.role).toBe('admin')
  })

  it('parses single character role', () => {
    const result = updateRoleSchema.parse({ role: 'a' })
    expect(result.role).toBe('a')
  })

  // ── Unhappy Path ──
  it('rejects missing role', () => {
    expect(() => updateRoleSchema.parse({})).toThrow()
  })

  it('rejects empty role string', () => {
    expect(() => updateRoleSchema.parse({ role: '' })).toThrow()
  })

  it('rejects role as number', () => {
    expect(() => updateRoleSchema.parse({ role: 123 })).toThrow()
  })

  it('rejects null role', () => {
    expect(() => updateRoleSchema.parse({ role: null })).toThrow()
  })

  // ── Error Handling ──
  it('produces readable error for missing role', () => {
    try { updateRoleSchema.parse({}) }
    catch (e) { assertParseError(e, 'role') }
  })
})

// ════════════════════════════════════════════════════════════════
// transferOwnershipSchema
// ════════════════════════════════════════════════════════════════

describe('transferOwnershipSchema', () => {
  // ── Happy Path ──
  it('parses valid UUID for new_owner_user_id', () => {
    const result = transferOwnershipSchema.parse({
      new_owner_user_id: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.new_owner_user_id).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  // ── Unhappy Path ──
  it('rejects missing new_owner_user_id', () => {
    expect(() => transferOwnershipSchema.parse({})).toThrow()
  })

  it('rejects non-UUID string', () => {
    expect(() => transferOwnershipSchema.parse({ new_owner_user_id: 'not-a-uuid' })).toThrow()
  })

  it('rejects empty string', () => {
    expect(() => transferOwnershipSchema.parse({ new_owner_user_id: '' })).toThrow()
  })

  it('rejects UUID without hyphens', () => {
    expect(() => transferOwnershipSchema.parse({
      new_owner_user_id: '550e8400e29b41d4a716446655440000',
    })).toThrow()
  })

  it('rejects number instead of UUID', () => {
    expect(() => transferOwnershipSchema.parse({ new_owner_user_id: 123 })).toThrow()
  })

  it('rejects null', () => {
    expect(() => transferOwnershipSchema.parse({ new_owner_user_id: null })).toThrow()
  })

  // ── Error Handling ──
  it('produces readable error for missing UUID', () => {
    try { transferOwnershipSchema.parse({}) }
    catch (e) { assertParseError(e, 'new_owner_user_id') }
  })
})

// ════════════════════════════════════════════════════════════════
// createImpersonationSchema
// ════════════════════════════════════════════════════════════════

describe('createImpersonationSchema', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000'

  // ── Happy Path ──
  it('parses with required fields only (expires_in_minutes defaults to 15)', () => {
    const result = createImpersonationSchema.parse({
      target_user_id: validUuid,
      target_tenant_id: validUuid,
    })
    expect(result.target_user_id).toBe(validUuid)
    expect(result.target_tenant_id).toBe(validUuid)
    expect(result.expires_in_minutes).toBe(15)
  })

  it('parses with custom expiration', () => {
    const result = createImpersonationSchema.parse({
      target_user_id: validUuid,
      target_tenant_id: validUuid,
      expires_in_minutes: 60,
    })
    expect(result.expires_in_minutes).toBe(60)
  })

  it('accepts minimum expiration (1)', () => {
    const result = createImpersonationSchema.parse({
      target_user_id: validUuid,
      target_tenant_id: validUuid,
      expires_in_minutes: 1,
    })
    expect(result.expires_in_minutes).toBe(1)
  })

  it('accepts maximum expiration (1440 = 24h)', () => {
    const result = createImpersonationSchema.parse({
      target_user_id: validUuid,
      target_tenant_id: validUuid,
      expires_in_minutes: 1440,
    })
    expect(result.expires_in_minutes).toBe(1440)
  })

  // ── Unhappy Path ──
  it('rejects missing target_user_id', () => {
    expect(() => createImpersonationSchema.parse({ target_tenant_id: validUuid })).toThrow()
  })

  it('rejects missing target_tenant_id', () => {
    expect(() => createImpersonationSchema.parse({ target_user_id: validUuid })).toThrow()
  })

  it('rejects invalid target_user_id (not a UUID)', () => {
    expect(() => createImpersonationSchema.parse({
      target_user_id: 'bad',
      target_tenant_id: validUuid,
    })).toThrow()
  })

  it('rejects invalid target_tenant_id', () => {
    expect(() => createImpersonationSchema.parse({
      target_user_id: validUuid,
      target_tenant_id: 'also-bad',
    })).toThrow()
  })

  it('rejects expires_in_minutes below minimum (0)', () => {
    expect(() => createImpersonationSchema.parse({
      target_user_id: validUuid,
      target_tenant_id: validUuid,
      expires_in_minutes: 0,
    })).toThrow()
  })

  it('rejects expires_in_minutes above maximum (1441)', () => {
    expect(() => createImpersonationSchema.parse({
      target_user_id: validUuid,
      target_tenant_id: validUuid,
      expires_in_minutes: 1441,
    })).toThrow()
  })

  it('rejects expires_in_minutes as float', () => {
    expect(() => createImpersonationSchema.parse({
      target_user_id: validUuid,
      target_tenant_id: validUuid,
      expires_in_minutes: 15.5,
    })).toThrow()
  })

  it('rejects expires_in_minutes as string', () => {
    expect(() => createImpersonationSchema.parse({
      target_user_id: validUuid,
      target_tenant_id: validUuid,
      expires_in_minutes: '15',
    })).toThrow()
  })

  // ── Error Handling ──
  it('produces readable error for missing target_user_id', () => {
    try { createImpersonationSchema.parse({ target_tenant_id: validUuid }) }
    catch (e) { assertParseError(e, 'target_user_id') }
  })
})

// ════════════════════════════════════════════════════════════════
// updateSettingsSchema
// ════════════════════════════════════════════════════════════════

describe('updateSettingsSchema', () => {
  // ── Happy Path ──
  it('parses empty object (all fields optional)', () => {
    const result = updateSettingsSchema.parse({})
    expect(result).toEqual({})
  })

  it('parses with all fields', () => {
    const result = updateSettingsSchema.parse({
      name: 'My Settings',
      settings: { theme: 'dark' },
      config: { region: 'eu-west' },
    })
    expect(result.name).toBe('My Settings')
    expect(result.settings).toEqual({ theme: 'dark' })
  })

  it('accepts name at minimum length', () => {
    const result = updateSettingsSchema.parse({ name: 'A' })
    expect(result.name).toBe('A')
  })

  it('accepts name at maximum length', () => {
    const name = 'a'.repeat(100)
    const result = updateSettingsSchema.parse({ name })
    expect(result.name).toBe(name)
  })

  // ── Unhappy Path ──
  it('rejects empty name', () => {
    expect(() => updateSettingsSchema.parse({ name: '' })).toThrow()
  })

  it('rejects name longer than 100', () => {
    expect(() => updateSettingsSchema.parse({ name: 'a'.repeat(101) })).toThrow()
  })

  it('rejects name as number', () => {
    expect(() => updateSettingsSchema.parse({ name: 123 })).toThrow()
  })

  it('rejects settings as string', () => {
    expect(() => updateSettingsSchema.parse({ settings: 'not-a-record' })).toThrow()
  })

  it('rejects config as array', () => {
    expect(() => updateSettingsSchema.parse({ config: [1, 2] })).toThrow()
  })

  // ── Unicode / Injection ──
  it('accepts Unicode in name', () => {
    const result = updateSettingsSchema.parse({ name: '設定' })
    expect(result.name).toBe('設定')
  })

  // ── Error Handling ──
  it('produces readable error for invalid name type', () => {
    try { updateSettingsSchema.parse({ name: 42 }) }
    catch (e) { assertParseError(e, 'name') }
  })
})

// ════════════════════════════════════════════════════════════════
// registerSchema
// ════════════════════════════════════════════════════════════════

describe('registerSchema', () => {
  const valid = {
    email: 'user@example.com',
    password: 'password123',
    tenant_name: 'My Company',
    tenant_slug: 'my-company',
  }

  // ── Happy Path ──
  it('parses valid registration input', () => {
    const result = registerSchema.parse(valid)
    expect(result.email).toBe('user@example.com')
    expect(result.password).toBe('password123')
    expect(result.tenant_name).toBe('My Company')
    expect(result.tenant_slug).toBe('my-company')
  })

  // ── Unhappy Path ──
  it('rejects missing email', () => {
    const { email, ...rest } = valid
    expect(() => registerSchema.parse(rest)).toThrow()
  })

  it('rejects invalid email', () => {
    expect(() => registerSchema.parse({ ...valid, email: 'bad' })).toThrow()
  })

  it('rejects empty email', () => {
    expect(() => registerSchema.parse({ ...valid, email: '' })).toThrow()
  })

  it('rejects short password (< 8 chars)', () => {
    expect(() => registerSchema.parse({ ...valid, password: '1234567' })).toThrow()
  })

  it('rejects missing password', () => {
    const { password, ...rest } = valid
    expect(() => registerSchema.parse(rest)).toThrow()
  })

  it('rejects missing tenant_name', () => {
    const { tenant_name, ...rest } = valid
    expect(() => registerSchema.parse(rest)).toThrow()
  })

  it('rejects empty tenant_name', () => {
    expect(() => registerSchema.parse({ ...valid, tenant_name: '' })).toThrow()
  })

  it('rejects tenant_name exceeding 100 chars', () => {
    expect(() => registerSchema.parse({ ...valid, tenant_name: 'a'.repeat(101) })).toThrow()
  })

  it('rejects missing tenant_slug', () => {
    const { tenant_slug, ...rest } = valid
    expect(() => registerSchema.parse(rest)).toThrow()
  })

  it('rejects empty tenant_slug', () => {
    expect(() => registerSchema.parse({ ...valid, tenant_slug: '' })).toThrow()
  })

  it('rejects slug with uppercase (regex)', () => {
    expect(() => registerSchema.parse({ ...valid, tenant_slug: 'My-Company' })).toThrow()
  })

  it('rejects slug with spaces', () => {
    expect(() => registerSchema.parse({ ...valid, tenant_slug: 'my company' })).toThrow()
  })

  it('rejects slug exceeding 50 chars', () => {
    expect(() => registerSchema.parse({ ...valid, tenant_slug: 'a'.repeat(51) })).toThrow()
  })

  it('rejects password as number', () => {
    expect(() => registerSchema.parse({ ...valid, password: 12345678 })).toThrow()
  })

  // ── Boundary ──
  it('accepts password exactly 8 characters', () => {
    const result = registerSchema.parse({ ...valid, password: '12345678' })
    expect(result.password).toBe('12345678')
  })

  it('accepts slug exactly 2 characters', () => {
    const result = registerSchema.parse({ ...valid, tenant_slug: 'ab' })
    expect(result.tenant_slug).toBe('ab')
  })

  it('accepts tenant_name exactly 100 characters', () => {
    const longName = 'a'.repeat(100)
    const result = registerSchema.parse({ ...valid, tenant_name: longName })
    expect(result.tenant_name).toBe(longName)
  })

  // ── Unicode ──
  it('accepts Unicode in tenant_name', () => {
    const result = registerSchema.parse({ ...valid, tenant_name: '株式会社テナント' })
    expect(result.tenant_name).toBe('株式会社テナント')
  })

  // ── Error Handling ──
  it('produces readable error for short password', () => {
    try { registerSchema.parse({ ...valid, password: 'short' }) }
    catch (e) {
      assertParseError(e)
      if (e instanceof Error) {
        expect(e.message).toContain('8')
      }
    }
  })
})

// ════════════════════════════════════════════════════════════════
// portalTenantCreateSchema
// ════════════════════════════════════════════════════════════════

describe('portalTenantCreateSchema', () => {
  // ── Happy Path ──
  it('parses valid portal tenant create input', () => {
    const result = portalTenantCreateSchema.parse({ name: 'New App', slug: 'new-app' })
    expect(result.name).toBe('New App')
    expect(result.slug).toBe('new-app')
  })

  it('accepts minimum length name (1 char)', () => {
    const result = portalTenantCreateSchema.parse({ name: 'A', slug: 'ab' })
    expect(result.name).toBe('A')
  })

  it('accepts maximum length name (100 chars)', () => {
    const name = 'a'.repeat(100)
    const result = portalTenantCreateSchema.parse({ name, slug: 'my-app' })
    expect(result.name).toBe(name)
  })

  it('accepts minimum length slug (2 chars)', () => {
    const result = portalTenantCreateSchema.parse({ name: 'Test', slug: 'ab' })
    expect(result.slug).toBe('ab')
  })

  it('accepts maximum length slug (50 chars)', () => {
    const slug = 'a'.repeat(50)
    const result = portalTenantCreateSchema.parse({ name: 'Test', slug })
    expect(result.slug).toBe(slug)
  })

  // ── Unhappy Path ──
  it('rejects missing name', () => {
    expect(() => portalTenantCreateSchema.parse({ slug: 'new-app' })).toThrow()
  })

  it('rejects missing slug', () => {
    expect(() => portalTenantCreateSchema.parse({ name: 'New App' })).toThrow()
  })

  it('rejects empty name', () => {
    expect(() => portalTenantCreateSchema.parse({ name: '', slug: 'new-app' })).toThrow()
  })

  it('rejects empty slug', () => {
    expect(() => portalTenantCreateSchema.parse({ name: 'New App', slug: '' })).toThrow()
  })

  it('rejects name exceeding 100 chars', () => {
    expect(() => portalTenantCreateSchema.parse({ name: 'a'.repeat(101), slug: 'app' })).toThrow()
  })

  it('rejects slug exceeding 50 chars', () => {
    expect(() => portalTenantCreateSchema.parse({ name: 'Test', slug: 'a'.repeat(51) })).toThrow()
  })

  it('rejects slug with uppercase', () => {
    expect(() => portalTenantCreateSchema.parse({ name: 'Test', slug: 'My-App' })).toThrow()
  })

  it('rejects slug with spaces', () => {
    expect(() => portalTenantCreateSchema.parse({ name: 'Test', slug: 'my app' })).toThrow()
  })

  it('rejects slug with special characters', () => {
    expect(() => portalTenantCreateSchema.parse({ name: 'Test', slug: 'my@app' })).toThrow()
  })

  it('rejects name as number', () => {
    expect(() => portalTenantCreateSchema.parse({ name: 123, slug: 'app' })).toThrow()
  })

  // ── Unicode / Injection ──
  it('accepts Unicode in name', () => {
    const result = portalTenantCreateSchema.parse({ name: 'Приложение', slug: 'app' })
    expect(result.name).toBe('Приложение')
  })

  // ── Error Handling ──
  it('produces readable error for invalid slug', () => {
    try { portalTenantCreateSchema.parse({ name: 'Test', slug: 'BAD' }) }
    catch (e) {
      assertParseError(e)
      if (e instanceof Error) {
        expect(e.message).toContain('lowercase')
      }
    }
  })
})

// ════════════════════════════════════════════════════════════════
// trackEventSchema
// ════════════════════════════════════════════════════════════════

describe('trackEventSchema', () => {
  // ── Happy Path ──
  it('parses minimal event (metric only)', () => {
    const result = trackEventSchema.parse({ metric: 'api.call' })
    expect(result.metric).toBe('api.call')
    expect(result.value).toBe(1) // default
    expect(result.properties).toEqual({}) // default
  })

  it('parses event with all fields', () => {
    const result = trackEventSchema.parse({
      metric: 'user.signup',
      value: 5,
      properties: { source: 'referral', plan: 'free' },
    })
    expect(result.value).toBe(5)
    expect(result.properties.source).toBe('referral')
  })

  it('accepts value of 0 (minimum)', () => {
    const result = trackEventSchema.parse({ metric: 'test', value: 0 })
    expect(result.value).toBe(0)
  })

  it('accepts metric at max length (100)', () => {
    const metric = 'a'.repeat(100)
    const result = trackEventSchema.parse({ metric })
    expect(result.metric).toBe(metric)
  })

  // ── Unhappy Path ──
  it('rejects missing metric', () => {
    expect(() => trackEventSchema.parse({})).toThrow()
  })

  it('rejects empty metric', () => {
    expect(() => trackEventSchema.parse({ metric: '' })).toThrow()
  })

  it('rejects metric exceeding 100 chars', () => {
    expect(() => trackEventSchema.parse({ metric: 'a'.repeat(101) })).toThrow()
  })

  it('rejects negative value', () => {
    expect(() => trackEventSchema.parse({ metric: 'test', value: -1 })).toThrow()
  })

  it('rejects metric as number', () => {
    expect(() => trackEventSchema.parse({ metric: 123 })).toThrow()
  })

  it('rejects value as string', () => {
    expect(() => trackEventSchema.parse({ metric: 'test', value: 'one' })).toThrow()
  })

  it('rejects properties as string', () => {
    expect(() => trackEventSchema.parse({ metric: 'test', properties: 'bad' })).toThrow()
  })

  // ── Unicode / Injection ──
  it('accepts Unicode in metric', () => {
    const result = trackEventSchema.parse({ metric: 'メトリック' })
    expect(result.metric).toBe('メトリック')
  })

  it('accepts SQL injection in metric (string is valid)', () => {
    const result = trackEventSchema.parse({ metric: "'; DROP TABLE events; --" })
    expect(result.metric).toBe("'; DROP TABLE events; --")
  })

  // ── Error Handling ──
  it('produces readable error for missing metric', () => {
    try { trackEventSchema.parse({}) }
    catch (e) { assertParseError(e, 'metric') }
  })
})

// ════════════════════════════════════════════════════════════════
// createPortalApiKeySchema
// ════════════════════════════════════════════════════════════════

describe('createPortalApiKeySchema', () => {
  // ── Happy Path ──
  it('parses with only label (scopes default to ["read"])', () => {
    const result = createPortalApiKeySchema.parse({ label: 'Portal Key' })
    expect(result.label).toBe('Portal Key')
    expect(result.scopes).toEqual(['read'])
  })

  it('parses with custom scopes', () => {
    const result = createPortalApiKeySchema.parse({ label: 'Admin Key', scopes: ['admin'] })
    expect(result.scopes).toEqual(['admin'])
  })

  it('parses with multiple scopes', () => {
    const result = createPortalApiKeySchema.parse({ label: 'Full Key', scopes: ['read', 'write', 'admin'] })
    expect(result.scopes).toEqual(['read', 'write', 'admin'])
  })

  it('accepts label at minimum length', () => {
    const result = createPortalApiKeySchema.parse({ label: 'K' })
    expect(result.label).toBe('K')
  })

  it('accepts label at maximum length', () => {
    const label = 'a'.repeat(100)
    const result = createPortalApiKeySchema.parse({ label })
    expect(result.label).toBe(label)
  })

  // ── Unhappy Path ──
  it('rejects missing label', () => {
    expect(() => createPortalApiKeySchema.parse({})).toThrow()
  })

  it('rejects empty label', () => {
    expect(() => createPortalApiKeySchema.parse({ label: '' })).toThrow()
  })

  it('rejects label exceeding 100 chars', () => {
    expect(() => createPortalApiKeySchema.parse({ label: 'a'.repeat(101) })).toThrow()
  })

  it('rejects label as number', () => {
    expect(() => createPortalApiKeySchema.parse({ label: 123 })).toThrow()
  })

  it('rejects scopes as string', () => {
    expect(() => createPortalApiKeySchema.parse({ label: 'Key', scopes: 'read' })).toThrow()
  })

  it('rejects null label', () => {
    expect(() => createPortalApiKeySchema.parse({ label: null })).toThrow()
  })

  // ── Unicode ──
  it('accepts Unicode in label', () => {
    const result = createPortalApiKeySchema.parse({ label: 'APIキー for 管理' })
    expect(result.label).toBe('APIキー for 管理')
  })

  // ── Injection ──
  it('accepts HTML in label (valid string)', () => {
    const result = createPortalApiKeySchema.parse({ label: '<img src=x onerror=alert(1)>' })
    expect(result.label).toBe('<img src=x onerror=alert(1)>')
  })

  // ── Error Handling ──
  it('produces readable error for missing label', () => {
    try { createPortalApiKeySchema.parse({ scopes: ['read'] }) }
    catch (e) { assertParseError(e, 'label') }
  })
})
