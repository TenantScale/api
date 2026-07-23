import { z } from 'zod'

/** Blocked internal hostnames that should never receive webhooks */
const BLOCKED_WEBHOOK_HOSTS = new Set([
  'localhost', '127.0.0.1', '::1', '0.0.0.0',
  'host.docker.internal', 'metadata.google.internal',
  '169.254.169.254',
])

/** Synchronous SSRF check for webhook URL Zod schemas */
export function ssrfUrlCheck(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    if (BLOCKED_WEBHOOK_HOSTS.has(host)) return false
    // Block private IP literals
    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (ipv4Match) {
      const parts = [parseInt(ipv4Match[1]), parseInt(ipv4Match[2]), parseInt(ipv4Match[3]), parseInt(ipv4Match[4])]
      if (parts.some(p => p > 255)) return false // Invalid IP
      if (parts[0] === 10) return false
      if (parts[0] === 127) return false
      if (parts[0] === 169 && parts[1] === 254) return false
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false
      if (parts[0] === 192 && parts[1] === 168) return false
      if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return false
      if (parts[0] === 0) return false
    }
    return true
  } catch {
    return false
  }
}

// ════════════════════════════════════════════════════════════════
// Tenants
// ════════════════════════════════════════════════════════════════

export const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  /** @deprecated Only used by admin endpoints. Public creation always forces 'free'. */
  plan_id: z.string().optional(),
})

export type CreateTenantInput = z.infer<typeof createTenantSchema>

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  is_active: z.boolean().optional(),
  plan_id: z.string().optional(),
  features: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>

// ════════════════════════════════════════════════════════════════
// API Keys
// ════════════════════════════════════════════════════════════════

export const createApiKeySchema = z.object({
  label: z.string().min(1).max(100),
  scopes: z.array(z.string()).default(['read', 'write']),
})

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>

// ════════════════════════════════════════════════════════════════
// Plans
// ════════════════════════════════════════════════════════════════

export const updatePlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  price_monthly: z.number().int().min(0).optional(),
  features: z.record(z.string(), z.union([z.boolean(), z.number(), z.string(), z.null()])).optional(),
  max_users: z.number().int().min(0).nullable().optional(),
  sort_order: z.number().int().optional(),
})

export type UpdatePlanInput = z.infer<typeof updatePlanSchema>

// ════════════════════════════════════════════════════════════════
// Audit Events
// ════════════════════════════════════════════════════════════════

export const createAuditEventSchema = z.object({
  action: z.string().min(1).max(200),
  resource: z.string().min(1).max(500),
  details: z.record(z.string(), z.unknown()).default({}),
  actor_id: z.string().uuid().optional(),
})

// ════════════════════════════════════════════════════════════════
// Users
// ════════════════════════════════════════════════════════════════

export const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.string().min(1, 'Role is required').default('member'),
})

export const updateRoleSchema = z.object({
  role: z.string().min(1, 'Role is required'),
})

export const transferOwnershipSchema = z.object({
  new_owner_user_id: z.string().uuid(),
})

// ════════════════════════════════════════════════════════════════
// Impersonation
// ════════════════════════════════════════════════════════════════

export const createImpersonationSchema = z.object({
  target_user_id: z.string().uuid(),
  target_tenant_id: z.string().uuid(),
  expires_in_minutes: z.number().int().min(1).max(1440).default(15),
})

// ════════════════════════════════════════════════════════════════
// Tenant Settings (Portal)
// ════════════════════════════════════════════════════════════════

export const updateSettingsSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

// ════════════════════════════════════════════════════════════════
// Registration
// ════════════════════════════════════════════════════════════════

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  tenant_name: z.string().min(1, 'Organization name is required').max(100),
  tenant_slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
})

// ════════════════════════════════════════════════════════════════
// Portal Tenant Creation (authenticated users)
// ════════════════════════════════════════════════════════════════

export const portalTenantCreateSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
})

export type PortalTenantCreateInput = z.infer<typeof portalTenantCreateSchema>

// ════════════════════════════════════════════════════════════════
// Usage Events
// ════════════════════════════════════════════════════════════════

export const trackEventSchema = z.object({
  metric: z.string().min(1).max(100),
  value: z.number().min(0).default(1),
  properties: z.record(z.string(), z.unknown()).default({}),
})

// ════════════════════════════════════════════════════════════════
// Portal API Key
// ════════════════════════════════════════════════════════════════

export const createPortalApiKeySchema = z.object({
  label: z.string().min(1).max(100),
  scopes: z.array(z.string()).default(['read']),
})

// ════════════════════════════════════════════════════════════════
// SSO / Social Login
// ════════════════════════════════════════════════════════════════

export const updateSsoSettingsSchema = z.object({
  enabled_providers: z.array(z.enum(['google', 'github', 'azure', 'discord', 'gitlab'])).default([]),
})

export type UpdateSsoSettingsInput = z.infer<typeof updateSsoSettingsSchema>
