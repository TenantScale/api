-- 002_update_plan_tiers.sql
-- TenantScale: Update plan tiers to match landing page pricing
--
-- Changes:
--   Add api_calls_per_day column to plans
--   Replace old plan IDs (free/indie/pro/business) with new tiers
--   Update max_tenants default (1 → 3)
--   Align feature flags, prices, and limits with landing page
-- ============================================================

-- ── Add api_calls_per_day column ──
alter table plans
  add column if not exists api_calls_per_day integer;

comment on column plans.api_calls_per_day is
  'Daily API call limit per tenant. Null = unlimited.';

-- ── Update max_tenants default ──
alter table plans
  alter column max_tenants set default 3;

-- ── Replace seed data ──
-- Delete old plans (safe in development; tenants reference plans via FK)
-- We use CASCADE-safe approach: update tenants to new plan first, then replace data.

-- First, update any tenants with old plan_ids to map to new ones
update tenants set plan_id = 'free' where plan_id = 'free';
update tenants set plan_id = 'hobby' where plan_id = 'indie';
update tenants set plan_id = 'pro' where plan_id = 'pro';
update tenants set plan_id = 'scale' where plan_id = 'business';

-- Now replace the plan data
delete from plans;

insert into plans (id, name, description, price_monthly, features, max_users, max_tenants, api_calls_per_day, sort_order) values
  ('free', 'Free', 'For side projects and prototypes — build your entire MVP at no cost', 0,
   '{"audit_log_retention_days": 7, "sso": false, "custom_domain": false, "team_members": 2, "webhooks": false, "api_access": true, "admin_dashboard": true}',
   2, 3, 1000, 1),

  ('hobby', 'Hobby', 'For early-stage SaaS with your first paying customers', 2900,
   '{"audit_log_retention_days": 30, "sso": false, "custom_domain": false, "team_members": 10, "webhooks": true, "api_access": true, "admin_dashboard": true}',
   10, 15, 10000, 2),

  ('pro', 'Pro', 'For growing B2B products that need audit trails and support', 9900,
   '{"audit_log_retention_days": 90, "sso": false, "custom_domain": false, "team_members": 100, "webhooks": true, "api_access": true, "admin_dashboard": true}',
   100, 100, 100000, 3),

  ('scale', 'Scale', 'For mid-market teams needing SSO, long retention, and priority support', 24900,
   '{"audit_log_retention_days": 365, "sso": false, "custom_domain": false, "team_members": 500, "webhooks": true, "api_access": true, "admin_dashboard": true}',
   500, 500, 500000, 4),

  ('enterprise', 'Enterprise', 'For large organizations with dedicated infrastructure and compliance needs', 0,
   '{"audit_log_retention_days": 3650, "sso": true, "custom_domain": true, "team_members": null, "webhooks": true, "api_access": true, "admin_dashboard": true}',
   null, null, null, 5);
