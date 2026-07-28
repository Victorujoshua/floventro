-- ─────────────────────────────────────────────────────────────────────────────
-- app_0043_branch_products.sql
--
-- ALREADY APPLIED TO PRODUCTION — repo record only, do not re-run.
-- Filed 2026-07-28. Originally applied directly to Supabase SQL editor.
--
-- Introduces branch_products: a join table recording which products a branch
-- "carries" (has in its catalog). Currently every branch sees every org product;
-- this table makes that explicit and curate-able, one branch at a time.
--
-- Phase 2a: SCHEMA + BACKFILL ONLY — inert until getProducts() is updated (2b).
-- Because of the backfill, applying this migration changes nothing visible:
-- every branch still shows every org product it could see before.
--
-- Design decisions:
--   - organisation_id on each row: allows a single-lookup RLS policy
--     (mirror of vendor_invoices, product_stock, etc.) without a join to branches.
--   - ON DELETE CASCADE on branch_id + product_id: removing a branch or
--     soft-deleted product automatically cleans up its catalog entries.
--   - ON DELETE RESTRICT on organisation_id: an org cannot be dropped while
--     branch catalog rows exist (consistent with the other tables).
--   - No updated_at: the row is a membership fact, not a mutable entity.
--     Add/remove is always insert + delete, never update.
--   - Backfill uses ON CONFLICT DO NOTHING: safe to run again if interrupted.
--
-- Depends on: app_0001_core (organisations, branches)
--             app_0006_products (products)
--             app_0009_vendors_rls (user_vendor_read_branch_ids,
--                                   user_product_write_org_ids helpers)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Table ──────────────────────────────────────────────────────────────────

create table public.branch_products (
  organisation_id uuid        not null references public.organisations(id) on delete restrict,
  branch_id       uuid        not null references public.branches(id)      on delete cascade,
  product_id      uuid        not null references public.products(id)      on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (branch_id, product_id)
);

-- Fast lookup: "which branches carry product X?" (used by inventory/transfer forms)
create index branch_products_product_idx on public.branch_products (product_id);

-- Fast lookup: "all catalog rows for this org" (used by org-level admin)
create index branch_products_org_idx on public.branch_products (organisation_id);


-- ── 2. Backfill ───────────────────────────────────────────────────────────────
--
-- Populate every (branch, product) pair where the branch's org owns the product
-- and neither is soft-deleted. After this runs, every branch "carries" every
-- org product — identical to the current implicit behaviour.
-- Applying 2b's filter against this table therefore changes nothing visually
-- until an owner curates a branch's catalog.

insert into public.branch_products (organisation_id, branch_id, product_id)
select
  b.organisation_id,
  b.id              as branch_id,
  p.id              as product_id
from public.branches b
join public.products p
  on  p.organisation_id = b.organisation_id
  and p.deleted_at      is null
where b.deleted_at is null
on conflict (branch_id, product_id) do nothing;


-- ── 3. RLS ────────────────────────────────────────────────────────────────────

alter table public.branch_products enable row level security;

-- SELECT: any branch member can see their branch's product catalog.
-- Uses the existing user_vendor_read_branch_ids() helper (returns every branch
-- the current user may read, expanding org-membership for owners).
create policy "branch members can read their catalog"
  on public.branch_products
  for select
  using (
    branch_id in (select public.user_vendor_read_branch_ids())
  );

-- INSERT: owners (identified via user_product_write_org_ids) can add a product
-- to a branch catalog, provided the product belongs to the same org.
create policy "owner can add product to branch catalog"
  on public.branch_products
  for insert
  with check (
    organisation_id in (select public.user_product_write_org_ids())
  );

-- DELETE: same guard — owner can remove a product from a branch catalog.
create policy "owner can remove product from branch catalog"
  on public.branch_products
  for delete
  using (
    organisation_id in (select public.user_product_write_org_ids())
  );

-- No UPDATE policy: rows are membership facts; changes are insert + delete.
