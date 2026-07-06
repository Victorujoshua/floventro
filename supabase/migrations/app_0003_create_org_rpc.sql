-- Migration: app_0003_create_org_rpc
-- The create_organisation() RPC — creates org + first owner membership atomically.
-- Security definer because membership inserts are otherwise blocked by RLS.
-- Depends on: app_0001_core.sql, app_0002_core_rls.sql

-- Creates org + first owner membership atomically
create or replace function public.create_organisation(
  org_name text,
  country_code text default 'NG',
  currency text default 'NGN',
  timezone text default 'Africa/Lagos'
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

  insert into organisations (name, country_code, currency, timezone)
  values (org_name, country_code, currency, timezone)
  returning id into new_org_id;

  insert into memberships (user_id, organisation_id, role)
  values (auth.uid(), new_org_id, 'owner');

  return new_org_id;
end;
$$;

revoke all on function public.create_organisation from public;
grant execute on function public.create_organisation to authenticated;
