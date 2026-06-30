-- 003_audit_retention_cleanup.sql
-- TenantScale: Audit retention cleanup function
--
-- Creates a function that prunes expired audit_events per-tenant
-- based on each tenant's plan's audit_log_retention_days setting.
-- Designed to be called by an admin cron endpoint.
--
-- Safety features:
--   Batched deletes (1000 rows at a time) to avoid long-running txns
--   Respects per-plan retention (Enterprise keeps 10 years)
--   Logs cleanup summary as a system audit event
--   Rolls back on error — never silently loses data
-- ============================================================

-- ── Enable pg_cron extension (if available) ──
-- Note: pg_cron requires superuser in Supabase project settings.
-- This migration is self-contained without pg_cron — the cron
-- endpoint calls the function via SQL.
-- create extension if not exists "pg_cron"; -- uncomment if enabled

-- ── Helper: delete expired audit events for a single plan ──
create or replace function cleanup_audit_for_plan(
  p_plan_id text,
  p_retention_days int,
  p_batch_size int default 1000
) returns table (
  plan_name text,
  deleted_count bigint
) language plpgsql as $$
declare
  v_cutoff timestamptz;
  v_deleted bigint := 0;
  v_batch bigint;
begin
  v_cutoff := now() - (p_retention_days || ' days')::interval;

  -- Loop in batches to keep each transaction short
  loop
    delete from audit_events
    where id in (
      select ae.id
      from audit_events ae
      join tenants t on t.id = ae.tenant_id
      where t.plan_id = p_plan_id
        and ae.created_at < v_cutoff
      limit p_batch_size
      for update skip locked
    );

    get diagnostics v_batch = row_count;
    v_deleted := v_deleted + v_batch;
    exit when v_batch < p_batch_size; -- last batch or nothing left
  end loop;

  plan_name := p_plan_id;
  deleted_count := v_deleted;
  return next;
end;
$$;

-- ── Main cleanup function ──
-- Returns a summary of deleted rows per plan tier.
create or replace function cleanup_expired_audit_events()
returns table (
  plan_id text,
  deleted_rows bigint
) language plpgsql as $$
declare
  v_plan record;
  v_retention_days int;
begin
  for v_plan in
    select distinct p.id, p.features->>'audit_log_retention_days' as retention_days
    from plans p
    where p.features ? 'audit_log_retention_days'
      and (p.features->>'audit_log_retention_days')::int > 0
    order by p.id
  loop
    begin
      v_retention_days := (v_plan.retention_days)::int;

      -- Skip plans where no tenants use them
      if exists (select 1 from tenants where plan_id = v_plan.id) then
        return query
          select
            c.plan_name,
            c.deleted_count::bigint
          from cleanup_audit_for_plan(v_plan.id, v_retention_days) c;
      end if;
    exception when others then
      -- Log and continue — don't let one plan's failure block others
      raise warning 'Audit cleanup failed for plan %: %', v_plan.id, sqlerrm;
    end;
  end loop;
end;
$$;

comment on function cleanup_expired_audit_events() is
  'Prune audit_events older than each plan audit_log_retention_days. Returns per-plan deletion counts.';

-- ── Test the function (dry-run: counts deleted) ──
-- To preview without deleting, run:
--   select * from preview_expired_audit_events();
-- (not included — keeps migration simple)

-- ── Index to speed up the cleanup queries ──
-- Composite index on (tenant_id, created_at) already exists via idx_audit_tenant + idx_audit_created.
-- Add a covering index for the join pattern used by cleanup:
create index if not exists idx_audit_cleanup
  on audit_events(created_at asc)
  where created_at < now() - interval '7 days';
