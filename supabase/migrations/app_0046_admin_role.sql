-- ─────────────────────────────────────────────────────────────────────────────
-- app_0046_admin_role.sql
--
-- Adds the 'admin' role to the DB layer: constraints, RLS helpers, and policies.
-- Scope: DB-only (constraints + helpers + RLS). App guards and dashboard
--        flags are NOT changed here — those come in steps 2 & 3.
--
-- Admin = full access to ONE branch. Absent from every org-level grant.
-- The hard boundary: user_owned_org_ids() is NOT touched. It remains
-- role = 'owner' only. That single function gates: org settings update,
-- branch creation/update, the /org route group, and the existing
-- invitations policies. Admin is explicitly excluded from all of these.
--
-- Depends on:
--   app_0001_core        (memberships table + constraint)
--   app_0005             (user_owned_org_ids, "read own memberships" policy)
--   app_0007_products_rls (user_product_write_org_ids, user_member_org_ids)
--   app_0009_vendors_rls  (user_vendor_write_branch_ids, user_vendor_read_branch_ids)
--   app_0011_stock_rls    (user_readable_invoice_ids)
--   app_0013_invitations  (invitations table + constraint)
--   app_0014_invitations_rls_and_rpc (invitation policies)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ SECTION 1 — CHECK CONSTRAINTS
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Both constraints were created inline (no explicit name), so PostgreSQL
-- auto-generated the names. Verify before applying:
--
--   select conname from pg_constraint
--    where conrelid = 'public.memberships'::regclass
--      and contype = 'c' and conname like '%role%';
--
--   select conname from pg_constraint
--    where conrelid = 'public.invitations'::regclass
--      and contype = 'c' and conname like '%role%';
--
-- Conventional auto-generated names are used below. If the live names differ,
-- update the DROP CONSTRAINT names accordingly.

-- ── 1a. memberships.role ─────────────────────────────────────────────────────
--
-- OLD (app_0001_core.sql:38):
--   role text not null check (role in ('owner', 'inventory', 'sales', 'internal_use'))
--
-- NEW:

alter table public.memberships
  drop constraint memberships_role_check;

alter table public.memberships
  add constraint memberships_role_check
  check (role in ('owner', 'inventory', 'sales', 'internal_use', 'admin'));


-- ── 1b. invitations.role ─────────────────────────────────────────────────────
--
-- OLD (app_0013_invitations.sql:17):
--   role text not null check (role in ('owner','inventory','sales','internal_use'))
--
-- NEW:

alter table public.invitations
  drop constraint invitations_role_check;

alter table public.invitations
  add constraint invitations_role_check
  check (role in ('owner', 'inventory', 'sales', 'internal_use', 'admin'));


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ SECTION 2 — RLS HELPERS: CHANGED
-- ╚══════════════════════════════════════════════════════════════════════════════

-- ── 2a. user_product_write_org_ids() — add 'admin' ──────────────────────────
--
-- Gates: products INSERT/UPDATE, service_types INSERT/UPDATE.
-- Products are org-scoped (no branch_id column), so write access is naturally
-- org-wide for any role that holds it. Admin needs product catalogue access
-- in their org — same reasoning as inventory today.
--
-- OLD body (app_0007_products_rls.sql):
--   select organisation_id
--   from memberships
--   where user_id = auth.uid()
--     and role in ('owner', 'inventory')
--     and deleted_at is null;
--
-- NEW body — 'admin' added:

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
    and role in ('owner', 'inventory', 'admin')
    and deleted_at is null;
$$;

revoke all    on function public.user_product_write_org_ids() from public;
grant execute on function public.user_product_write_org_ids() to authenticated;


-- ── 2b. user_vendor_write_branch_ids() — add 'admin' ── CRITICAL ─────────────
--
-- THE most important branch-write helper. Gates (direct or via callers):
--   • vendors INSERT/UPDATE
--   • vendor_invoices INSERT/UPDATE
--   • staff_holdings SELECT (manager leg: branch_id in this set)
--   • user_readable_invoice_ids() → vendor_invoice_lines SELECT
--   • user_readable_service_ids() → service_records / service_consumption SELECT
--   • record_service_usage RPC: membership gate calls this
--   • return_to_branch RPC: membership gate calls this
--   • review_stock_request RPC: membership gate calls this
--
-- OLD body (app_0009_vendors_rls.sql):
--   -- inventory role: only the specific branches they belong to
--   select branch_id
--   from memberships
--   where user_id = auth.uid()
--     and role = 'inventory'
--     and branch_id is not null
--     and deleted_at is null
--   union
--   -- owner role: all non-deleted branches in their owned orgs
--   select b.id
--   from branches b
--   where b.deleted_at is null
--     and b.organisation_id in (
--       select organisation_id
--       from memberships
--       where user_id = auth.uid()
--         and role = 'owner'
--         and deleted_at is null
--     );
--
-- NEW body — 'admin' added to the first leg (role = 'inventory' → role IN ('inventory','admin')):

create or replace function public.user_vendor_write_branch_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  -- inventory + admin role: only the specific branch(es) they belong to
  select branch_id
  from memberships
  where user_id = auth.uid()
    and role in ('inventory', 'admin')
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

revoke all    on function public.user_vendor_write_branch_ids() from public;
grant execute on function public.user_vendor_write_branch_ids() to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ SECTION 2 — RLS HELPERS: UNCHANGED (explicit confirmation)
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- These helpers are NOT modified. Admin is either automatically included by
-- their existing membership row, or deliberately excluded (org-level boundary).

-- ── user_owned_org_ids() — UNCHANGED, admin ABSENT — THE ORG BOUNDARY ────────
--
-- Body (app_0005_fix_memberships_rls_recursion.sql):
--   select organisation_id
--   from memberships
--   where user_id = auth.uid()
--     and role = 'owner'   ← role = 'owner' only, hard-coded, never changed
--     and deleted_at is null;
--
-- Gates (all stay owner-only):
--   • organisations UPDATE ("update own org")
--   • branches INSERT ("insert branches as owner")
--   • branches UPDATE ("update branches as owner")
--   • invitations SELECT ("owners can view org invitations") — extended in §3
--   • invitations INSERT ("owners can create invitations") — extended in §3
--   • invitations UPDATE ("owners can update invitations") — extended in §3
--   • memberships SELECT (org-wide read for owners) — extended in §3
--   • accept_invitation() RPC: no role restriction there; unchanged
--
-- CONFIRMED: 'admin' is absent from user_owned_org_ids(). This is the single
-- function that enforces the org-level boundary. It will not be touched.

-- ── user_vendor_read_branch_ids() — UNCHANGED, admin already covered ──────────
--
-- Body (app_0009_vendors_rls.sql):
--   select branch_id
--   from memberships
--   where user_id = auth.uid()
--     and branch_id is not null
--     and deleted_at is null          ← no role filter — ANY role qualifies
--   union
--   select b.id from branches b where b.deleted_at is null
--     and b.organisation_id in (
--       select organisation_id from memberships
--       where user_id = auth.uid() and role = 'owner' and deleted_at is null
--     );
--
-- Admin has branch_id IS NOT NULL in their membership row. The first leg
-- (no role filter) returns admin's branch ID already. No change needed.
--
-- Gates: vendors SELECT, product_stock SELECT, stock_ledger SELECT,
--         vendor_invoices SELECT, user_readable_invoice_ids() (→ invoice_lines SELECT).

-- ── user_member_org_ids() — UNCHANGED, admin already covered ─────────────────
--
-- Body (app_0007_products_rls.sql):
--   select organisation_id
--   from memberships
--   where user_id = auth.uid()
--     and deleted_at is null          ← no role filter — ANY role qualifies
--
-- Admin has an active membership → org is returned. No change needed.
--
-- Gates: products SELECT, service_types SELECT.

-- ── user_readable_invoice_ids() — UNCHANGED, inherits from read_branch_ids ────
--
-- Body (app_0011_stock_rls.sql):
--   select id from public.vendor_invoices
--   where deleted_at is null
--     and branch_id in (select public.user_vendor_read_branch_ids());
--
-- Delegates entirely to user_vendor_read_branch_ids() (admin already in that set).
-- Gates: vendor_invoice_lines SELECT.

-- ── user_readable_service_ids() — UNCHANGED, inherits from write_branch_ids ───
--
-- Body (app_0026_service_usage.sql):
--   select id from public.service_records
--    where performed_by = auth.uid()
--       or branch_id in (select public.user_vendor_write_branch_ids());
--
-- Delegates to user_vendor_write_branch_ids() for the manager leg. Once §2b
-- above is applied, admin is automatically in that set. No further change needed.
-- Gates: service_records SELECT, service_consumption SELECT.


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ SECTION 3 — ADMIN TEAM VISIBILITY + INVITE POWER
-- ╚══════════════════════════════════════════════════════════════════════════════

-- ── 3a. New helper: user_admin_branch_ids() ───────────────────────────────────
--
-- Returns branch IDs where the current user holds the 'admin' role.
-- Used by:
--   • memberships SELECT policy (admin sees branch-member rows)
--   • invitations SELECT policy (admin sees branch invitations)
--   • invitations INSERT policy (admin creates branch invitations, escalation guard)
--   • invitations UPDATE policy (admin revokes branch invitations they created)
--
-- SECURITY DEFINER: reads memberships table bypassing RLS. Safe — the helper
-- returns only data derived from the caller's own membership rows (auth.uid()).

create or replace function public.user_admin_branch_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select branch_id
  from memberships
  where user_id = auth.uid()
    and role    = 'admin'
    and branch_id is not null
    and deleted_at is null;
$$;

revoke all    on function public.user_admin_branch_ids() from public;
grant execute on function public.user_admin_branch_ids() to authenticated;


-- ── 3b. memberships SELECT — extend for admin branch-team visibility ──────────
--
-- CURRENT policy (set by app_0005_fix_memberships_rls_recursion.sql):
--   create policy "read own memberships" on public.memberships
--   for select using (
--     user_id = auth.uid()
--     or organisation_id in (select public.user_owned_org_ids())
--   );
--
-- NEW — adds third OR clause: admin sees all membership rows for their branch.
--
-- Nuance — owner rows (branch_id IS NULL):
--   Owner memberships have branch_id = NULL and cannot match
--   branch_id IN (user_admin_branch_ids()). Admin cannot see owner-membership
--   rows through this policy. The team UI for admin must use a SECURITY DEFINER
--   RPC to also fetch org-wide memberships from the same org (step 2 / app code).

drop policy if exists "read own memberships" on public.memberships;

create policy "read own memberships" on public.memberships
for select using (
  user_id = auth.uid()
  or organisation_id in (select public.user_owned_org_ids())
  or branch_id in (select public.user_admin_branch_ids())
);


-- ── 3c. invitations policies — extend for admin branch-invite power ───────────
--
-- CURRENT policies (app_0014_invitations_rls_and_rpc.sql):
--   SELECT: organisation_id in (user_owned_org_ids())   → owner-only
--   INSERT: organisation_id in (user_owned_org_ids())   → owner-only
--   UPDATE: organisation_id in (user_owned_org_ids())   → owner-only (both clauses)
--
-- NEW design:
--   SELECT: owner sees entire org's invites; admin sees their branch's invites.
--   INSERT: owner inserts any role for their org; admin inserts non-admin roles
--           for their branch only. ESCALATION GUARD blocks admin from inviting admin.
--   UPDATE: owner revokes any invite in their org; admin revokes only invites
--           they personally created (invited_by = auth.uid()) in their branch.

drop policy if exists "owners can view org invitations"   on public.invitations;
drop policy if exists "owners can create invitations"     on public.invitations;
drop policy if exists "owners can update invitations"     on public.invitations;

-- SELECT ──────────────────────────────────────────────────────────────────────
-- Owner: full org visibility (unchanged from app_0014).
-- Admin: all invitations whose branch_id is in their admin branches.
-- Invitees still have zero SELECT access — acceptance is RPC-only, unchanged.

create policy "owners and admins can view invitations"
  on public.invitations
  for select
  to authenticated
  using (
    organisation_id in (select public.user_owned_org_ids())
    or branch_id in (select public.user_admin_branch_ids())
  );

-- INSERT (with escalation guard) ──────────────────────────────────────────────
--
-- Path A (owner): can invite any role, including 'admin', for any branch in
--   their org. Unrestricted — same power as before.
--
-- Path B (admin): can insert invitations ONLY when:
--   (i)  The target branch_id is one of their admin branches, AND
--   (ii) The invited role is NOT 'admin'.
--
-- How the escalation guard works:
--   If an admin tries to insert role = 'admin':
--     • Path B fails: 'admin' ∉ ('sales','inventory','internal_use').
--     • Path A fails: admin is not in user_owned_org_ids().
--     • INSERT is rejected at the DB layer. No app-level trust required.

create policy "owners and admins can create invitations"
  on public.invitations
  for insert
  to authenticated
  with check (
    -- Path A: org owner — any role, any branch in their org.
    organisation_id in (select public.user_owned_org_ids())
    or
    -- Path B: branch admin — non-admin roles only, own branch only.
    (
      branch_id in (select public.user_admin_branch_ids())
      and role in ('sales', 'inventory', 'internal_use')
    )
  );

-- UPDATE (revoke) ─────────────────────────────────────────────────────────────
--
-- USING restricts which rows the caller can see for update.
-- WITH CHECK restricts what the row must look like after update.
--
-- Owner: can revoke any invitation in their org (unchanged from app_0014).
-- Admin: can revoke only invitations that:
--   (i)  target their branch (branch_id guard), AND
--   (ii) they personally created (invited_by = auth.uid()).
--
-- invited_by guard prevents admin from revoking owner-created invitations
-- or invitations created by a different admin in the same branch.

create policy "owners and admins can update invitations"
  on public.invitations
  for update
  to authenticated
  using (
    -- Owner: full org revoke power.
    organisation_id in (select public.user_owned_org_ids())
    or
    -- Admin: only revoke their own invitations for their branch.
    (
      branch_id in (select public.user_admin_branch_ids())
      and invited_by = auth.uid()
    )
  )
  with check (
    organisation_id in (select public.user_owned_org_ids())
    or
    (
      branch_id in (select public.user_admin_branch_ids())
      and invited_by = auth.uid()
    )
  );


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ BOUNDARY STATEMENT
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Admin IS granted (after this migration):
--   ✓ Branch vendor writes (vendors INSERT/UPDATE)
--   ✓ Branch invoice writes (vendor_invoices INSERT/UPDATE)
--   ✓ Branch product catalogue writes (products INSERT/UPDATE)
--   ✓ Branch service-type writes (service_types INSERT/UPDATE)
--   ✓ Branch transfer initiation/receipt/cancel (via user_vendor_write_branch_ids)
--   ✓ Branch stock-request approval (via user_vendor_write_branch_ids in RPC gate)
--   ✓ Branch stock adjustments (via user_vendor_write_branch_ids in RPC gate)
--   ✓ Branch service-record visibility (user_readable_service_ids → write_branch_ids)
--   ✓ Branch staff-holdings visibility (staff_holdings SELECT manager leg)
--   ✓ Branch return_to_branch RPC (membership gate uses read_branch_ids; any member)
--   ✓ Branch team READ (memberships for their branch via user_admin_branch_ids)
--   ✓ Branch invitations: view, create (non-admin roles), revoke own invitations
--
-- Admin is NOT granted:
--   ✗ organisations UPDATE (gates on user_owned_org_ids — owner-only)
--   ✗ branches INSERT/UPDATE (gates on user_owned_org_ids — owner-only)
--   ✗ Access to other branches (user_vendor_write_branch_ids first leg scoped to role)
--   ✗ Inviting other admins (INSERT escalation guard: role NOT IN 'admin')
--   ✗ Revoking owner-created invitations (invited_by guard in UPDATE policy)
--   ✗ memberships outside their branch (branch_id guard in SELECT policy)
--   ✗ /org views (gated by requireOwner() in app layer — unchanged until step 2)
--   ✗ Org settings / payout / costing method (requireOwner() in app layer)
--   ✗ user_owned_org_ids() returns nothing for admin — this is the master gate
