-- ─────────────────────────────────────────────────────────────────────────────
-- app_0047_get_branch_members_rpc.sql
--
-- Adds get_branch_members(p_branch_id), a SECURITY DEFINER RPC that returns
-- all membership rows for a branch INCLUDING org owner rows (branch_id IS NULL).
--
-- Why this exists:
--   The memberships RLS SELECT policy (app_0046) allows admin to see rows where
--   branch_id IN (user_admin_branch_ids()). Owner memberships have branch_id IS NULL
--   so they never match that condition. Admin therefore cannot see the org owner
--   in their branch team list via direct Supabase client queries.
--
--   This RPC bypasses RLS (SECURITY DEFINER) after a strict caller-identity guard,
--   and returns the full branch team including owner rows.
--
-- Guard:
--   Caller must be:
--     (a) an owner of the org that owns the branch, OR
--     (b) an admin of that specific branch.
--   Any other caller gets a permission error — no data leaks.
--
-- Returns:
--   All non-deleted membership rows where branch_id = p_branch_id
--   UNION all non-deleted owner rows for the same org (branch_id IS NULL).
--   Includes branch name via LEFT JOIN for direct use by the team UI.
--
-- Depends on: app_0046_admin_role (user_owned_org_ids, user_admin_branch_ids)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.get_branch_members(p_branch_id uuid)
returns table (
  id              uuid,
  user_id         uuid,
  role            text,
  branch_id       uuid,
  branch_name     text,
  created_at      timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org_id uuid;
begin
  -- Resolve the org that owns this branch.
  select organisation_id into v_org_id
  from public.branches
  where id = p_branch_id and deleted_at is null;

  if v_org_id is null then
    raise exception 'branch not found or deleted';
  end if;

  -- Guard: caller must be an owner of this org or an admin of this branch.
  if not (
    v_org_id in (select public.user_owned_org_ids())
    or p_branch_id in (select public.user_admin_branch_ids())
  ) then
    raise exception 'not authorised to view members of this branch';
  end if;

  return query
    select
      m.id,
      m.user_id,
      m.role,
      m.branch_id,
      b.name  as branch_name,
      m.created_at
    from public.memberships m
    left join public.branches b on b.id = m.branch_id
    where m.organisation_id = v_org_id
      and m.deleted_at is null
      and (
        m.branch_id = p_branch_id   -- branch members
        or m.branch_id is null      -- org owners (always visible to branch admins)
      )
    order by m.created_at asc;
end;
$$;

revoke all    on function public.get_branch_members(uuid) from public;
grant execute on function public.get_branch_members(uuid) to authenticated;
