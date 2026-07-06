-- Migration: app_0002_core_rls
-- Enables RLS on organisations, branches, memberships.
-- Defines read/write policies scoped by membership.
-- Depends on: app_0001_core.sql
--
-- Key rules:
-- - Users can read orgs/branches they have a membership in
-- - Only owners can create/update branches
-- - Membership inserts happen only via security-definer RPCs (app_0003)
-- - No INSERT policy on organisations — direct inserts denied by default.
--   The only path to create an org is via create_organisation() RPC (app_0003).

-- Enable RLS
alter table public.organisations enable row level security;
alter table public.branches enable row level security;
alter table public.memberships enable row level security;

-- Organisations: readable if you have a membership in it
create policy "read own org" on public.organisations
for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.organisation_id = organisations.id
      and m.deleted_at is null
  )
);

-- Organisations: only owners can update their org
create policy "update own org" on public.organisations
for update using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.organisation_id = organisations.id
      and m.role = 'owner'
      and m.deleted_at is null
  )
);

-- Branches: readable if you have any membership in the org
create policy "read branches in own org" on public.branches
for select using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.organisation_id = branches.organisation_id
      and m.deleted_at is null
  )
);

-- Branches: only owners can create/update
create policy "insert branches as owner" on public.branches
for insert with check (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.organisation_id = branches.organisation_id
      and m.role = 'owner'
      and m.deleted_at is null
  )
);

create policy "update branches as owner" on public.branches
for update using (
  exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.organisation_id = branches.organisation_id
      and m.role = 'owner'
      and m.deleted_at is null
  )
);

-- Memberships: readable if it's your own OR if you're an owner of the org
create policy "read own memberships" on public.memberships
for select using (
  user_id = auth.uid()
  or exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.organisation_id = memberships.organisation_id
      and m.role = 'owner'
      and m.deleted_at is null
  )
);

-- Memberships: inserts happen via security-definer RPCs only (see app_0003)
-- No public insert policy.
