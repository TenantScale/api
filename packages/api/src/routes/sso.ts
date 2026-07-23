// ──────────────────────────────────────────────────────
// SSO / Social Login routes
// ──────────────────────────────────────────────────────
// Manages tenant-level SSO provider configuration and
// initiates OAuth flows via the configured auth adapter.

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { supabase } from '../db/supabase.js'
import { updateSsoSettingsSchema } from './schemas.js'
import { requirePortalSession, requirePortalRole, getSession } from '../middleware/session-auth.js'
import type { PortalSession } from '../middleware/session-auth.js'
import { supabaseError } from '../lib/response.js'
import { logger } from '../lib/logger.js'

export const ssoRoutes = new Hono()

// ── Helpers ──

const ALL_PROVIDERS = ['google', 'github', 'azure', 'discord', 'gitlab'] as const

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  github: 'GitHub',
  azure: 'Microsoft Azure',
  discord: 'Discord',
  gitlab: 'GitLab',
}

/** Check if SSO is enabled for a given plan */
async function planHasSso(planId: string): Promise<boolean> {
  const { data: plan } = await supabase
    .from('plans')
    .select('features')
    .eq('id', planId)
    .single()

  if (!plan) return false
  const features = plan.features as Record<string, unknown> ?? {}
  return features.sso === true || features.sso === 'enterprise'
}

// ── GET /portal/auth/providers — Available OAuth providers for this tenant's plan ──
ssoRoutes.get('/portal/auth/providers', requirePortalSession, async (c) => {
  const session: PortalSession = getSession(c)

  if (!session.tenant_id) {
    return c.json({ providers: [], sso_enabled: false })
  }

  // Check if the tenant's plan supports SSO
  const { data: tenant } = await supabase
    .from('tenants')
    .select('plan_id')
    .eq('id', session.tenant_id)
    .single()

  const ssoEnabled = tenant ? await planHasSso(tenant.plan_id) : false

  // Return the universal provider list — Supabase project-level OAuth
  // For now, always show Google and GitHub as available options
  const providers = ALL_PROVIDERS.map(p => ({
    provider: p,
    name: PROVIDER_LABELS[p] ?? p,
    available: ssoEnabled,
  }))

  return c.json({ providers, sso_enabled: ssoEnabled })
})

// ── GET /portal/auth/sso-settings — Tenant's SSO provider preferences ──
ssoRoutes.get('/portal/auth/sso-settings', requirePortalSession, requirePortalRole('owner', 'admin'), async (c) => {
  const session: PortalSession = getSession(c)

  const { data: settings } = await supabase
    .from('sso_settings')
    .select('enabled_providers, updated_at')
    .eq('tenant_id', session.tenant_id)
    .maybeSingle()

  return c.json({
    enabled_providers: settings?.enabled_providers ?? [],
    updated_at: settings?.updated_at ?? null,
  })
})

// ── PATCH /portal/auth/sso-settings — Update tenant's SSO provider preferences ──
ssoRoutes.patch('/portal/auth/sso-settings', requirePortalSession, requirePortalRole('owner', 'admin'), zValidator('json', updateSsoSettingsSchema), async (c) => {
  const session: PortalSession = getSession(c)
  const body = c.req.valid('json')

  // Verify the tenant's plan supports SSO
  const { data: tenant } = await supabase
    .from('tenants')
    .select('plan_id')
    .eq('id', session.tenant_id)
    .single()

  if (!tenant || !(await planHasSso(tenant.plan_id))) {
    return c.json({
      error: 'SSO is not available on your current plan. Upgrade to enable social login.',
      code: 'PLAN_FEATURE_SSO',
    }, 403)
  }

  // Upsert sso_settings
  const { error } = await supabase
    .from('sso_settings')
    .upsert({
      tenant_id: session.tenant_id,
      enabled_providers: body.enabled_providers,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) return supabaseError(c, error)

  logger.info({
    tenantId: session.tenant_id,
    providers: body.enabled_providers,
    actor: session.email,
  }, 'SSO settings updated')

  return c.json({
    enabled_providers: body.enabled_providers,
    updated_at: new Date().toISOString(),
  })
})
