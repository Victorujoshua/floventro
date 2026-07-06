-- Migration: app_0004_update_create_org_rpc
-- Extends create_organisation() to also create a default "Main" branch.
-- Onboarding becomes a single step. Users can rename or add branches later.
-- Depends on: app_0001_core.sql, app_0002_core_rls.sql, app_0003_create_org_rpc.sql

create or replace function public.create_organisation(
  org_name text,
  country_code text default 'NG',
  currency text default 'NGN',
  timezone text default 'Africa/Lagos',
  first_branch_name text default 'Main'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Create the organisation
  insert into organisations (name, country_code, currency, timezone)
  values (org_name, country_code, currency, timezone)
  returning id into new_org_id;

  -- Create the owner membership (branch_id NULL = spans all branches)
  insert into memberships (user_id, organisation_id, role)
  values (auth.uid(), new_org_id, 'owner');

  -- Create the default first branch
  insert into branches (organisation_id, name)
  values (new_org_id, first_branch_name);

  return new_org_id;
end;
$$;

revoke all on function public.create_organisation from public;
grant execute on function public.create_organisation to authenticated;
