-- ════════════════════════════════════════════════════════════════
-- Migration 005: SSO Settings + Auth Adapter Support
-- ════════════════════════════════════════════════════════════════

-- Track which social login providers are enabled per tenant
CREATE TABLE sso_settings (
  tenant_id         uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled_providers text[] NOT NULL DEFAULT '{}',
  -- For future: custom OIDC provider config
  -- custom_oidc_name        text,
  -- custom_oidc_client_id   text,
  -- custom_oidc_issuer      text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Add SSO feature flag to plan features (done via JSONB, but track column for querying)
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sso_enabled boolean NOT NULL DEFAULT false;

-- Seed SSO flag for existing plans
UPDATE plans SET sso_enabled = CASE id
  WHEN 'free' THEN false
  WHEN 'hobby' THEN false
  WHEN 'pro' THEN true
  WHEN 'scale' THEN true
  WHEN 'enterprise' THEN true
END;

-- Also seed the features JSONB for existing plans to include sso
UPDATE plans SET features = features || jsonb_build_object('sso', sso_enabled);
