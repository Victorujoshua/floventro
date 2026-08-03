-- ─────────────────────────────────────────────────────────────────────────────
-- app_0052_feature_visibility.sql
--
-- Per-branch, per-role feature visibility.
--
-- Design: row presence = HIDDEN. Absence = visible.
-- Empty table → every feature visible to every role everywhere. No seed data
-- needed to preserve existing behaviour when this migration is first applied.
--
-- Toggleable roles: 'sales', 'inventory', 'internal_use'.
-- 'owner' and 'admin' are ALWAYS visible — enforced by the role CHECK constraint,
-- so those roles can never have a hide-row inserted even by an admin.
--
-- RLS write policy mirrors the invitations pattern from app_0046:
--   • Owner  → any non-deleted branch in their org (via user_owned_org_ids())
--   • Admin  → only the specific branch(es) they admin (via user_admin_branch_ids())
--   Both helpers are SECURITY DEFINER and were defined in app_0046.
--
-- is_feature_visible() — SECURITY DEFINER helper for server-side route guards.
--   Returns TRUE when no hide-row exists (absence = visible).
--   Returns TRUE when p_branch_id IS NULL (owner at org level, all features on).
--
-- Depends on:
--   app_0001_core         (branches table)
--   app_0005              (user_owned_org_ids)
--   app_0009              (user_vendor_read_branch_ids — covers ALL roles)
--   app_0046_admin_role   (user_admin_branch_ids)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Table ─────────────────────────────────────────────────────────────────────

create table public.feature_visibility (
  id         uuid         not null default gen_random_uuid(),
  branch_id  uuid         not null references public.branches(id) on delete cascade,
  feature    text         not null,
  role       text         not null,
  hidden_by  uuid         not null references auth.users(id),
  hidden_at  timestamptz  not null default now(),

  constraint feature_visibility_pkey
    primary key (id),

  -- Extensible: add future features here (e.g. 'reports', 'services').
  constraint feature_visibility_feature_check
    check (feature in ('fulfilment')),

  -- Only operational roles are toggleable.
  -- 'owner' and 'admin' are structurally excluded — a hide-row for those roles
  -- can never be inserted.
  constraint feature_visibility_role_check
    check (role in ('sales', 'inventory', 'internal_use')),

  constraint feature_visibility_branch_feature_role_key
    unique (branch_id, feature, role)
);


-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.feature_visibility enable row level security;

-- SELECT: any branch member can read visibility state for their branch.
-- user_vendor_read_branch_ids() covers every role with a branch membership plus
-- all branches in an owner's org — no role filter, so sales/inventory/admin all
-- qualify. This allows the app layout to query hidden features for the current
-- session without needing a SECURITY DEFINER wrapper.
create policy "feature_visibility_select"
  on public.feature_visibility
  for select
  to authenticated
  using (
    branch_id in (select public.user_vendor_read_branch_ids())
  );

-- INSERT: owner (any branch in their org) OR admin (their branch only).
-- Mirrors the invitations INSERT policy from app_0046 §3c.
create policy "feature_visibility_insert"
  on public.feature_visibility
  for insert
  to authenticated
  with check (
    -- Owner path: any non-deleted branch in their owned orgs.
    exists (
      select 1
        from public.branches b
       where b.id            = branch_id
         and b.deleted_at    is null
         and b.organisation_id in (select public.user_owned_org_ids())
    )
    or
    -- Admin path: only the specific branch(es) they admin.
    -- user_admin_branch_ids() returns only branches where the caller is 'admin'.
    branch_id in (select public.user_admin_branch_ids())
  );

-- DELETE: same scope as INSERT.
-- No UPDATE policy — rows are insert-or-delete only (toggle pattern).
create policy "feature_visibility_delete"
  on public.feature_visibility
  for delete
  using (
    exists (
      select 1
        from public.branches b
       where b.id            = branch_id
         and b.deleted_at    is null
         and b.organisation_id in (select public.user_owned_org_ids())
    )
    or
    branch_id in (select public.user_admin_branch_ids())
  );


-- ── is_feature_visible() ─────────────────────────────────────────────────────
--
-- Route guards call this via .rpc() to backstop access at the server.
-- SECURITY DEFINER so the function runs as its owner (postgres), bypassing RLS
-- and allowing it to be called from any authenticated session regardless of role.
--
-- Caller pattern (Next.js server component):
--   const { data: visible } = await supabase.rpc("is_feature_visible", {
--     p_feature: "fulfilment", p_branch_id: scope.branchId, p_role: scope.role
--   })
--   if (visible === false) redirect("/dashboard")
--
-- p_branch_id = NULL (owner at org level, no branch entered):
--   Returns TRUE — all features are on when there is no branch context.
--
-- p_role in ('owner', 'admin'):
--   The role CHECK on feature_visibility prevents rows for these roles.
--   NOT EXISTS will always return TRUE → always visible. Correct by design.

create or replace function public.is_feature_visible(
  p_feature   text,
  p_branch_id uuid,
  p_role      text
) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select p_branch_id is null
      or not exists (
           select 1
             from public.feature_visibility
            where branch_id = p_branch_id
              and feature   = p_feature
              and role      = p_role
         );
$$;

revoke all    on function public.is_feature_visible(text, uuid, text) from public;
grant execute on function public.is_feature_visible(text, uuid, text) to authenticated;
