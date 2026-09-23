-- ─────────────────────────────────────────────────────────────────────────────
-- app_0071_membership_edit_remove.sql
--
-- Lets organisation owners edit an active member's role and remove (soft-delete)
-- active members. memberships has no INSERT/UPDATE/DELETE RLS policies, so both
-- writes go through SECURITY DEFINER RPCs that enforce every guard atomically.
--
-- Changes:
--   1. Replace the table-level unique (user_id, organisation_id, branch_id, role)
--      with a partial unique index over non-deleted rows only — same pattern as
--      vendors_branch_name_unique. Without this, accept_invitation hits 23505
--      when a removed member is re-invited to the same branch + role (its
--      duplicate guard only skips ACTIVE rows, then inserts).
--
--   2. update_membership_role(p_membership_id, p_role)
--        - caller must own the membership's organisation
--        - caller cannot edit their own membership
--        - owner rows cannot be edited (owner promotion/demotion out of scope)
--        - p_role must be inventory | sales | internal_use | admin
--        - unique collision → 'this member already has that role in this branch'
--
--   3. remove_membership(p_membership_id) — sets deleted_at
--        - caller must own the membership's organisation
--        - caller cannot remove their own membership
--        - cannot remove the last active owner of the organisation
--        - target must not hold stock (staff_holdings.quantity > 0 anywhere in
--          the org) — return_to_branch is holder-initiated, so a removed member's
--          held stock would be stranded
--
-- All guard failures raise P0001 with a user-facing message; the server actions
-- pass those messages straight through to the UI.
--
-- Depends on: app_0001_core (memberships), app_0005 (user_owned_org_ids),
--             app_0022_staff_holdings, app_0046_admin_role (admin role value)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Unique constraint → partial unique index ──────────────────────────────
--
-- The original constraint was declared inline in app_0001_core.sql, so its name
-- is auto-generated (normally memberships_user_id_organisation_id_branch_id_role_key).
-- Drop it by column set rather than by name so a differing live name can't
-- leave the old constraint in place.

do $$
declare
  v_conname text;
begin
  for v_conname in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.memberships'::regclass
       and c.contype  = 'u'
       and (
         select array_agg(a.attname::text order by a.attname::text)
           from pg_attribute a
          where a.attrelid = c.conrelid
            and a.attnum   = any (c.conkey)
       ) = array['branch_id', 'organisation_id', 'role', 'user_id']
  loop
    execute format('alter table public.memberships drop constraint %I', v_conname);
  end loop;
end
$$;

create unique index memberships_user_org_branch_role_unique
  on public.memberships (user_id, organisation_id, branch_id, role)
  where deleted_at is null;


-- ── 2. update_membership_role ─────────────────────────────────────────────────

create or replace function public.update_membership_role(
  p_membership_id uuid,
  p_role          text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.memberships%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_role is null or p_role not in ('inventory', 'sales', 'internal_use', 'admin') then
    raise exception 'role must be Inventory, Sales, Internal Use or Branch Admin';
  end if;

  select * into v_member
    from public.memberships
   where id = p_membership_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'team member not found';
  end if;

  if not exists (
    select 1 from public.user_owned_org_ids() as o(org_id)
     where o.org_id = v_member.organisation_id
  ) then
    raise exception 'only organisation owners can edit team members';
  end if;

  if v_member.user_id = auth.uid() then
    raise exception 'you cannot change your own role';
  end if;

  if v_member.role = 'owner' then
    raise exception 'owner roles cannot be changed';
  end if;

  if v_member.role = p_role then
    return;
  end if;

  begin
    update public.memberships
       set role = p_role
     where id = p_membership_id;
  exception when unique_violation then
    raise exception 'this member already has that role in this branch';
  end;
end;
$$;

revoke all    on function public.update_membership_role(uuid, text) from public;
grant execute on function public.update_membership_role(uuid, text) to authenticated;


-- ── 3. remove_membership ──────────────────────────────────────────────────────

create or replace function public.remove_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member       public.memberships%rowtype;
  v_other_owners integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_member
    from public.memberships
   where id = p_membership_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'team member not found';
  end if;

  if not exists (
    select 1 from public.user_owned_org_ids() as o(org_id)
     where o.org_id = v_member.organisation_id
  ) then
    raise exception 'only organisation owners can remove team members';
  end if;

  if v_member.user_id = auth.uid() then
    raise exception 'you cannot remove yourself from the organisation';
  end if;

  -- Last-owner guard. Lock the org's active owner rows so two concurrent
  -- removals can't each see "another owner exists" and remove both.
  if v_member.role = 'owner' then
    perform 1
       from public.memberships
      where organisation_id = v_member.organisation_id
        and role            = 'owner'
        and deleted_at      is null
      for update;

    select count(*) into v_other_owners
      from public.memberships
     where organisation_id = v_member.organisation_id
       and role            = 'owner'
       and deleted_at      is null
       and id             <> v_member.id;

    if v_other_owners = 0 then
      raise exception 'you cannot remove the last owner of the organisation';
    end if;
  end if;

  if exists (
    select 1
      from public.staff_holdings
     where organisation_id = v_member.organisation_id
       and holder_user_id  = v_member.user_id
       and quantity        > 0
  ) then
    raise exception 'this member is holding stock — have them return it before removing';
  end if;

  update public.memberships
     set deleted_at = now()
   where id = p_membership_id;
end;
$$;

revoke all    on function public.remove_membership(uuid) from public;
grant execute on function public.remove_membership(uuid) to authenticated;
