-- Migration: app_0005_fix_memberships_rls_recursion
-- Fixes infinite recursion in the memberships SELECT policy.
-- The old policy queried memberships inside its own USING clause (owner check),
-- which Postgres flagged as infinite recursion, causing all membership reads
-- through the anon client to error out — breaking scope resolution entirely.
-- Fix: a security-definer helper that reads owned org ids WITHOUT triggering RLS.
-- Depends on: app_0001_core.sql, app_0002_core_rls.sql

create or replace function public.user_owned_org_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select organisation_id
  from memberships
  where user_id = auth.uid()
    and role = 'owner'
    and deleted_at is null;
$$;

revoke all on function public.user_owned_org_ids from public;
grant execute on function public.user_owned_org_ids to authenticated;

drop policy if exists "read own memberships" on public.memberships;

create policy "read own memberships" on public.memberships
for select using (
  user_id = auth.uid()
  or organisation_id in (select public.user_owned_org_ids())
);
