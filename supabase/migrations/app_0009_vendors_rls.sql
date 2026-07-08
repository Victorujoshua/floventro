-- Migration: app_0009_vendors_rls
-- RLS policies for the vendors table.
-- Vendors are BRANCH-scoped. Owners (branch_id IS NULL in memberships) span all
-- branches in their org via a join to the branches table.
-- All membership lookups go through security-definer helpers — no policy
-- queries the vendors table inside its own USING/WITH CHECK clause.
-- Depends on: app_0001_core.sql (branches table),
--             app_0008_vendors.sql (vendors table)

-- ── Security-definer helpers ────────────────────────────────────────────────

-- Returns branch IDs the current user may READ vendors in:
--   1. Any branch where the user has a direct membership (any role)
--   2. All branches in orgs where the user is an owner
--      (owners have branch_id IS NULL in memberships, meaning they span all branches)
create or replace function public.user_vendor_read_branch_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  -- direct branch memberships (any role, including inventory/sales/internal_use)
  select branch_id
  from memberships
  where user_id = auth.uid()
    and branch_id is not null
    and deleted_at is null
  union
  -- all non-deleted branches in orgs the user owns
  select b.id
  from branches b
  where b.deleted_at is null
    and b.organisation_id in (
      select organisation_id
      from memberships
      where user_id = auth.uid()
        and role = 'owner'
        and deleted_at is null
    );
$$;

revoke all on function public.user_vendor_read_branch_ids from public;
grant execute on function public.user_vendor_read_branch_ids to authenticated;

-- Returns branch IDs the current user may WRITE vendors in (create, update, soft-delete):
--   1. Branches where the user has an inventory membership
--   2. All branches in orgs where the user is an owner
create or replace function public.user_vendor_write_branch_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  -- inventory role: only the specific branches they belong to
  select branch_id
  from memberships
  where user_id = auth.uid()
    and role = 'inventory'
    and branch_id is not null
    and deleted_at is null
  union
  -- owner role: all non-deleted branches in their owned orgs
  select b.id
  from branches b
  where b.deleted_at is null
    and b.organisation_id in (
      select organisation_id
      from memberships
      where user_id = auth.uid()
        and role = 'owner'
        and deleted_at is null
    );
$$;

revoke all on function public.user_vendor_write_branch_ids from public;
grant execute on function public.user_vendor_write_branch_ids to authenticated;

-- ── Enable RLS ───────────────────────────────────────────────────────────────

alter table public.vendors enable row level security;

-- ── Policies ────────────────────────────────────────────────────────────────

-- Any member of the branch (or owner of the org) can read vendors in that branch.
create policy "read vendors in own branch" on public.vendors
for select using (
  branch_id in (select public.user_vendor_read_branch_ids())
);

-- Only owner or inventory role may insert vendors into a branch.
create policy "insert vendors as owner or inventory" on public.vendors
for insert with check (
  branch_id in (select public.user_vendor_write_branch_ids())
);

-- Only owner or inventory role may update vendors (includes soft-delete via deleted_at).
create policy "update vendors as owner or inventory" on public.vendors
for update using (
  branch_id in (select public.user_vendor_write_branch_ids())
);
