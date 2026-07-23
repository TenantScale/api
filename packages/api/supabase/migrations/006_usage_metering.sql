-- ════════════════════════════════════════════════════════════════
-- Migration 006: Usage Metering + Billing Tables
-- ════════════════════════════════════════════════════════════════
-- Formalizes existing usage_events and rate_limits tables
-- (created manually, no migration artifact), and adds billing
-- period tracking for metered/seat-based billing.
-- ════════════════════════════════════════════════════════════════

-- ── 1. usage_events (formalize existing table) ──
-- Stores individual usage events for metering/billing analytics.
-- Each row represents one unit of consumption (e.g., 1 API call, 1 storage MB).
-- Retained indefinitely for billing/invoicing purposes.
CREATE TABLE IF NOT EXISTS usage_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric      text NOT NULL,
  value       numeric NOT NULL DEFAULT 1,
  properties  jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for analytics queries (per-tenant, per-metric, time-range scans)
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_metric_time
  ON usage_events (tenant_id, metric, created_at);

-- Index for billing-period aggregation (per-tenant, time-range)
CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_time
  ON usage_events (tenant_id, created_at);

-- ── 2. rate_limits (formalize existing table) ──
-- Daily counters for plan-based API call rate limiting.
-- Each row tracks one tenant's consumption on a given date.
CREATE TABLE IF NOT EXISTS rate_limits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date        date NOT NULL,
  count       integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, date)
);

-- ── 3. rate_limit_increment function (formalize existing RPC) ──
-- Atomically increments the daily counter for a tenant.
-- Returns the new count *after* incrementing.
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_tenant_id uuid,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO rate_limits (tenant_id, date, count)
  VALUES (p_tenant_id, p_date, 1)
  ON CONFLICT (tenant_id, date)
  DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

-- ── 4. billing_periods ──
-- Tracks each tenant's billing cycles for metered/seat-based billing.
-- A period is created when a tenant subscribes or is upgraded.
-- Metered usage is aggregated per period and synced to Stripe.
CREATE TABLE IF NOT EXISTS billing_periods (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id   uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz,
  -- Status: active = current billing period, closed = invoiced, synced = sent to Stripe
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'synced')),
  -- Stripe usage record summary (set when synced)
  stripe_sync_status    text CHECK (stripe_sync_status IN ('pending', 'synced', 'failed')),
  stripe_sync_error     text,
  last_synced_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_periods_tenant
  ON billing_periods (tenant_id, status, starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_periods_active
  ON billing_periods (status) WHERE status = 'active';

-- ── 5. Add usage metering columns to plans ──
-- These enable per-plan metered pricing configuration.
-- If null, the plan doesn't support overages (hard-capped at limit).
ALTER TABLE plans ADD COLUMN IF NOT EXISTS overage_rate_per_call numeric;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS overage_rate_per_user numeric;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS stripe_metered_price_id text;  -- Stripe price ID for per-call metering
ALTER TABLE plans ADD COLUMN IF NOT EXISTS stripe_seat_price_id text;     -- Stripe price ID for per-seat metering

-- Add usage limits to plan features JSONB for existing plans
UPDATE plans SET features = features || jsonb_build_object(
  'overage_api_calls', CASE
    WHEN id IN ('pro', 'scale') THEN true
    ELSE false
  END,
  'overage_seats', CASE
    WHEN id IN ('pro', 'scale') THEN true
    ELSE false
  END,
  'usage_dashboard', CASE
    WHEN id IN ('pro', 'scale', 'enterprise') THEN true
    ELSE false
  END
);

-- Set default overage rates
UPDATE plans SET
  overage_rate_per_call = CASE
    WHEN id = 'pro' THEN 0.001    -- $0.001 per overage API call
    WHEN id = 'scale' THEN 0.0005 -- $0.0005 per overage API call
    ELSE NULL
  END,
  overage_rate_per_user = CASE
    WHEN id = 'pro' THEN 5.00     -- $5/extra user/month
    WHEN id = 'scale' THEN 3.00   -- $3/extra user/month
    ELSE NULL
  END;
