-- ─────────────────────────────────────────────────────────────────────────────
-- app_0055_service_types_sales_write.sql
--
-- Grants the sales role write access to service_types (create / edit services)
-- WITHOUT touching user_product_write_org_ids() or products' write policies.
--
-- Mechanism: introduce user_service_write_org_ids() — a separate helper that
-- mirrors user_product_write_org_ids() but adds 'sales'. Replace the two
-- service_types write policies (INSERT + UPDATE) to use the new helper.
-- Products are completely unaffected.
--
-- Depends on: app_0026_service_usage (service_types table + existing policies)
--             app_0046_admin_role    (current user_product_write_org_ids body)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. New helper ─────────────────────────────────────────────────────────────
--
-- Separate from user_product_write_org_ids() so product write access is NOT
-- affected. Only service_types policies will use this function.

create or replace function public.user_service_write_org_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select organisation_id
  from memberships
  where user_id = auth.uid()
    and role in ('owner', 'inventory', 'admin', 'sales')
    and deleted_at is null;
$$;

revoke all    on function public.user_service_write_org_ids() from public;
grant execute on function public.user_service_write_org_ids() to authenticated;


-- ── 2. Replace write policies ──────────────────────────────────────────────────
--
-- Drop the two existing policies (created in app_0026, untouched since).
-- Names confirmed against live migration history.

drop policy if exists "service_types: owner/inventory write"  on public.service_types;
drop policy if exists "service_types: owner/inventory update" on public.service_types;

create policy "service_types: write"
  on public.service_types
  for insert
  with check (organisation_id in (select public.user_service_write_org_ids()));

create policy "service_types: update"
  on public.service_types
  for update
  using  (organisation_id in (select public.user_service_write_org_ids()))
  with check (organisation_id in (select public.user_service_write_org_ids()));


-- ── 3. Reload PostgREST schema cache ──────────────────────────────────────────

notify pgrst, 'reload schema';
