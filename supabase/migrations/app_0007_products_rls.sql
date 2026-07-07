-- Migration: app_0007_products_rls
-- RLS policies for the products table.
-- All membership lookups go through security-definer helpers — no policy
-- queries the products table inside its own USING/WITH CHECK clause.
-- Depends on: app_0005_fix_memberships_rls_recursion.sql (pattern),
--             app_0006_products.sql (products table)

-- ── Security-definer helpers ────────────────────────────────────────────────

-- Returns org IDs where the current user has ANY active membership.
-- Used for read access (all roles can read the catalogue).
create or replace function public.user_member_org_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select organisation_id
  from memberships
  where user_id = auth.uid()
    and deleted_at is null;
$$;

revoke all on function public.user_member_org_ids from public;
grant execute on function public.user_member_org_ids to authenticated;

-- Returns org IDs where the current user holds owner or inventory role.
-- Used for write access (only these roles may mutate the catalogue).
create or replace function public.user_product_write_org_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select organisation_id
  from memberships
  where user_id = auth.uid()
    and role in ('owner', 'inventory')
    and deleted_at is null;
$$;

revoke all on function public.user_product_write_org_ids from public;
grant execute on function public.user_product_write_org_ids to authenticated;

-- ── Enable RLS ───────────────────────────────────────────────────────────────

alter table public.products enable row level security;

-- ── Policies ────────────────────────────────────────────────────────────────

-- Any member of the org can read products (including soft-deleted, for ledger references).
-- The application layer filters deleted_at is null for normal list views.
create policy "read products in own org" on public.products
for select using (
  organisation_id in (select public.user_member_org_ids())
);

-- Only owner / inventory may insert products.
create policy "insert products as owner or inventory" on public.products
for insert with check (
  organisation_id in (select public.user_product_write_org_ids())
);

-- Only owner / inventory may update products (includes soft-delete via deleted_at).
create policy "update products as owner or inventory" on public.products
for update using (
  organisation_id in (select public.user_product_write_org_ids())
);
