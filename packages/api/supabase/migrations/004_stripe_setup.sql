-- 004_stripe_setup.sql
-- TenantScale: Stripe subscriptions and customer mapping
--
-- Adds tables for Stripe integration:
--   stripe_customers  → maps tenants to Stripe Customer IDs
--   subscriptions     → tracks active subscription state
--
-- RLS: stripe_customers readable by tenant members, writable by API (service_role).
--      subscriptions readable by tenant members, writable by webhooks (service_role).
-- ============================================================

-- ── Stripe Customers ──
-- Maps each tenant to a Stripe Customer object.

create table if not exists stripe_customers (
  id                uuid default gen_random_uuid() primary key,
  tenant_id         uuid not null references tenants(id) on delete cascade unique,
  stripe_customer_id text not null unique,
  created_at        timestamptz default now()
);

create index if not exists idx_stripe_customers_tenant
  on stripe_customers(tenant_id);
create index if not exists idx_stripe_customers_stripe_id
  on stripe_customers(stripe_customer_id);

comment on table stripe_customers is
  'Maps TenantScale tenants to Stripe Customer objects for billing';

-- ── Subscriptions ──
-- Tracks each tenant's active Stripe subscription.
-- A tenant may have at most one active subscription at a time.

create type subscription_status as enum (
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'paused'
);

create table if not exists subscriptions (
  id                    uuid default gen_random_uuid() primary key,
  tenant_id             uuid not null references tenants(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id    text not null,
  stripe_price_id       text not null,
  status                subscription_status not null default 'incomplete',
  plan_id               text not null references plans(id),
  billing_interval      text not null default 'month' check (billing_interval in ('month', 'year')),
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  canceled_at           timestamptz,
  ended_at              timestamptz,
  trial_start           timestamptz,
  trial_end             timestamptz,
  metadata              jsonb not null default '{}',
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- Only one active subscription per tenant (status in active, past_due, trialing)
create unique index if not exists idx_subscriptions_active_tenant
  on subscriptions(tenant_id)
  where status in ('active', 'past_due', 'trialing');

create index if not exists idx_subscriptions_stripe_subscription
  on subscriptions(stripe_subscription_id);
create index if not exists idx_subscriptions_tenant
  on subscriptions(tenant_id);
create index if not exists idx_subscriptions_status
  on subscriptions(status);

comment on table subscriptions is
  'Tracks each tenant Stripe subscription. One active sub per tenant at a time.';

-- ── Auto-update updated_at ──
create or replace function update_subscriptions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_subscriptions_updated_at
  before update on subscriptions
  for each row
  execute function update_subscriptions_updated_at();

-- ── ROW LEVEL SECURITY ──

-- stripe_customers: tenant members can read, only service_role can write
alter table stripe_customers enable row level security;

create policy "stripe_customers_tenant_select" on stripe_customers
  for select using (
    tenant_id in (
      select tenant_id from tenant_users where user_id = auth.uid()
    )
  );

-- Subscriptions: tenant members can read, only service_role can write
alter table subscriptions enable row level security;

create policy "subscriptions_tenant_select" on subscriptions
  for select using (
    tenant_id in (
      select tenant_id from tenant_users where user_id = auth.uid()
    )
  );
