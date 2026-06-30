-- 001_initial_schema.sql
-- TenantScale: Multi-Tenant SaaS Middleware
--
-- This migration sets up the core multi-tenant data model:
--   tenants       → the organizations/customers
--   tenant_users  → users who belong to each tenant
--   audit_events  → every action performed across all tenants
--   api_keys      → per-tenant API keys for SDK authentication
--   plans         → available subscription plans (seeded data)

-- ============================================================
-- EXTENSIONS
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- PLANS (lookup table, seeded by migration)
-- ============================================================
create table plans (
  id          text primary key,                -- 'free', 'hobby', 'pro', 'scale', 'enterprise'
  name        text not null,
  description text,
  price_monthly integer not null default 0,    -- cents, 0 = free
  features    jsonb not null default '{}',      -- feature flag map
  max_users   integer,                          -- null = unlimited
  max_tenants integer default 3,               -- null = unlimited (enterprise)
  api_calls_per_day integer,                    -- null = unlimited
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);

comment on table plans is 'Available subscription plans with feature flags and limits';

-- ============================================================
-- TENANTS (the core entity — each customer organization)
-- ============================================================
create table tenants (
  id          uuid default gen_random_uuid() primary key,
  name        text not null,
  slug        text unique not null,
  plan_id     text not null default 'free' references plans(id),
  features    jsonb not null default '{}',      -- plan overrides / trial unlocks
  config      jsonb not null default '{}',      -- tenant-specific settings
  settings    jsonb not null default '{}',      -- white-label, branding, custom domain
  is_active   boolean not null default true,
  metadata    jsonb default '{}',               -- arbitrary key-value storage
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index idx_tenants_slug on tenants(slug);
create index idx_tenants_plan on tenants(plan_id);

comment on table tenants is 'Each row = one customer organization in your B2B SaaS';
comment on column tenants.features is 'Feature overrides beyond the plan (e.g. trial unlocks)';
comment on column tenants.config is 'Runtime configuration values for this tenant';
comment on column tenants.settings is 'UI/white-label settings (logo, colors, custom domain)';

-- ============================================================
-- TENANT USERS (membership join table)
-- ============================================================
create table tenant_users (
  id          uuid default gen_random_uuid() primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member'
              check (role in ('owner', 'admin', 'member', 'viewer')),
  invited_by  uuid references tenant_users(id),
  joined_at   timestamptz default now(),
  unique(user_id, tenant_id)
);

create index idx_tenant_users_tenant on tenant_users(tenant_id);
create index idx_tenant_users_user on tenant_users(user_id);

comment on table tenant_users is 'Maps Supabase auth.users to tenants with role-based access';

-- ============================================================
-- API KEYS (for SDK authentication)
-- ============================================================
create table api_keys (
  id          uuid default gen_random_uuid() primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  label       text not null,                    -- "Production", "Staging"
  key_hash    text not null unique,             -- sha256 of the raw key
  key_prefix  text not null,                    -- first 8 chars for identification
  scopes      text[] default '{read}',          -- 'read', 'write', 'admin'
  created_by  uuid references auth.users(id),
  expires_at  timestamptz,
  is_active   boolean not null default true,
  last_used_at timestamptz,
  created_at  timestamptz default now()
);

create index idx_api_keys_tenant on api_keys(tenant_id);

comment on table api_keys is 'Per-tenant API keys used by the @tenantscale/sdk SDK';

-- ============================================================
-- AUDIT EVENTS (every action, everywhere)
-- ============================================================
create table audit_events (
  id          uuid default gen_random_uuid() primary key,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  actor_id    uuid,                              -- user who performed the action
  actor_type  text not null default 'user'
              check (actor_type in ('user', 'system', 'admin_impersonation')),
  action      text not null,                    -- 'tenant.created', 'user.impersonated', 'plan.changed'
  resource    text not null,                    -- 'tenant:uuid', 'user:uuid', 'subscription:id'
  details     jsonb not null default '{}',       -- action-specific payload
  ip          inet,
  user_agent  text,
  created_at  timestamptz default now()
);

create index idx_audit_tenant on audit_events(tenant_id);
create index idx_audit_created on audit_events(created_at desc);
create index idx_audit_action on audit_events(action);

comment on table audit_events is 'Immutable audit log — every action across all tenants';

-- ============================================================
-- IMPERSONATION SESSIONS (admin feature)
-- ============================================================
create table impersonation_sessions (
  id              uuid default gen_random_uuid() primary key,
  admin_user_id   uuid not null references auth.users(id),
  target_user_id  uuid not null references auth.users(id),
  target_tenant_id uuid not null references tenants(id),
  token_hash      text not null unique,          -- one-time use token
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  created_at      timestamptz default now()
);

create index idx_impersonation_admin on impersonation_sessions(admin_user_id);

comment on table impersonation_sessions is 'One-time admin impersonation tokens with audit trail';

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Tenants: users see only their own tenant
alter table tenants enable row level security;
create policy "tenant_self_read" on tenants
  for select using (
    id in (select tenant_id from tenant_users where user_id = auth.uid())
  );

-- TODO: Add INSERT policy for tenant creation (currently admin-only via API)

-- Tenant Users: users see members of their own tenant
alter table tenant_users enable row level security;
create policy "tenant_users_self_read" on tenant_users
  for select using (
    tenant_id in (select tenant_id from tenant_users where user_id = auth.uid())
  );

-- Audit: tenant members see their own audit
alter table audit_events enable row level security;
create policy "audit_tenant_read" on audit_events
  for select using (
    tenant_id in (select tenant_id from tenant_users where user_id = auth.uid())
  );

-- API Keys: only visible to the owning tenant
alter table api_keys enable row level security;
create policy "api_keys_tenant_read" on api_keys
  for select using (
    tenant_id in (select tenant_id from tenant_users where user_id = auth.uid())
  );

-- Impersonation: only the admin who created it can see it
alter table impersonation_sessions enable row level security;
create policy "impersonation_self" on impersonation_sessions
  for select using (admin_user_id = auth.uid());

-- ============================================================
-- SEED DATA: Default Plans
-- ============================================================
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

-- ============================================================
-- HELPER: updated_at trigger
-- ============================================================
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tenants_updated_at
  before update on tenants
  for each row execute function update_updated_at_column();

-- ============================================================
-- HELPER: Create tenant on first user signup
-- ============================================================
-- This is called by your API, not an auto-trigger.
-- Tenants should be created explicitly through your onboarding flow.
-- But this helper simplifies the common pattern:
create or replace function create_tenant(
  p_name text,
  p_slug text,
  p_plan_id text default 'free',
  p_owner_user_id uuid default null,
  p_owner_email text default null
)
returns tenants as $$
declare
  v_tenant tenants;
begin
  -- Create the tenant
  insert into tenants (name, slug, plan_id)
  values (p_name, p_slug, p_plan_id)
  returning * into v_tenant;

  -- If an owner user is specified, add them
  if p_owner_user_id is not null then
    insert into tenant_users (tenant_id, user_id, role)
    values (v_tenant.id, p_owner_user_id, 'owner');
  end if;

  -- Log the event
  insert into audit_events (tenant_id, actor_id, actor_type, action, resource, details)
  values (v_tenant.id, p_owner_user_id, 'system', 'tenant.created',
          'tenant:' || v_tenant.id,
          jsonb_build_object('name', p_name, 'slug', p_slug, 'plan', p_plan_id));

  return v_tenant;
end;
$$ language plpgsql;
