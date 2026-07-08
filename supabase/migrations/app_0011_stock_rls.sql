-- Migration: app_0011_stock_rls
-- RLS policies for the four stock tables introduced in app_0010_stock.sql.
--
-- REUSABILITY ANALYSIS — existing helpers from app_0009_vendors_rls.sql:
--
--   user_vendor_read_branch_ids()
--     Returns branch IDs the current user may read from: their direct memberships
--     (any role) plus all branches of orgs they own. This is EXACTLY the access
--     predicate needed for product_stock, stock_ledger, and vendor_invoices reads.
--     → REUSED AS-IS. No new read-branch helper needed.
--
--   user_vendor_write_branch_ids()
--     Returns branch IDs the current user may write in: inventory-role memberships
--     plus all branches of orgs they own. This is EXACTLY the access predicate
--     needed for vendor_invoice INSERT/UPDATE.
--     → REUSED AS-IS. No new write-branch helper needed.
--
-- NEW HELPER REQUIRED:
--
--   user_readable_invoice_ids()
--     vendor_invoice_lines has no branch_id column — access must be derived from
--     the parent invoice. A security-definer helper avoids RLS-on-RLS cascades
--     that would occur if the policy queried vendor_invoices (an RLS-protected
--     table) inside vendor_invoice_lines' own policy.
--
-- WRITE POLICIES FOR product_stock AND stock_ledger:
--     Intentionally absent. Only the security-definer RPC (Task 3.2) writes these
--     tables. Because the RPC runs as SECURITY DEFINER it bypasses RLS entirely,
--     so no INSERT/UPDATE policy is needed — and the absence of a write policy
--     means direct user writes are denied at the database layer.
--
-- Depends on: app_0009_vendors_rls.sql (helpers reused above)
--             app_0010_stock.sql        (tables being secured)

-- ── New security-definer helper ──────────────────────────────────────────────

-- Returns the IDs of vendor_invoices whose branch the current user may read.
-- Used by the vendor_invoice_lines SELECT policy to avoid querying an
-- RLS-protected table (vendor_invoices) from inside another policy.
create or replace function public.user_readable_invoice_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
  from public.vendor_invoices
  where deleted_at is null
    and branch_id in (select public.user_vendor_read_branch_ids());
$$;

revoke all on function public.user_readable_invoice_ids from public;
grant execute on function public.user_readable_invoice_ids to authenticated;

-- ── Enable RLS ────────────────────────────────────────────────────────────────

alter table public.product_stock         enable row level security;
alter table public.stock_ledger           enable row level security;
alter table public.vendor_invoices        enable row level security;
alter table public.vendor_invoice_lines   enable row level security;

-- ── product_stock policies ────────────────────────────────────────────────────
-- SELECT only. No INSERT/UPDATE policy — writes reserved for the security-definer RPC.

create policy "read product_stock in own branch" on public.product_stock
for select using (
  branch_id in (select public.user_vendor_read_branch_ids())
);

-- ── stock_ledger policies ─────────────────────────────────────────────────────
-- SELECT only. No INSERT/UPDATE/DELETE policy — this table is immutable and written
-- exclusively by the security-definer RPC. Absence of a write policy = denied.

create policy "read stock_ledger in own branch" on public.stock_ledger
for select using (
  branch_id in (select public.user_vendor_read_branch_ids())
);

-- ── vendor_invoices policies ──────────────────────────────────────────────────

-- Any member of the branch (or owner of the org) can read invoices.
create policy "read vendor_invoices in own branch" on public.vendor_invoices
for select using (
  branch_id in (select public.user_vendor_read_branch_ids())
);

-- Only owner or inventory role may create invoices.
create policy "insert vendor_invoices as owner or inventory" on public.vendor_invoices
for insert with check (
  branch_id in (select public.user_vendor_write_branch_ids())
);

-- Only owner or inventory role may update invoices (includes soft-delete via deleted_at,
-- status updates, and payment recording in future tasks).
create policy "update vendor_invoices as owner or inventory" on public.vendor_invoices
for update using (
  branch_id in (select public.user_vendor_write_branch_ids())
);

-- ── vendor_invoice_lines policies ────────────────────────────────────────────
-- SELECT gated through user_readable_invoice_ids() to avoid RLS-on-RLS cascades.
-- No INSERT/UPDATE/DELETE policy — line items are written exclusively by the
-- security-definer RPC that also writes the invoice header and stock ledger entries.

create policy "read vendor_invoice_lines via parent invoice" on public.vendor_invoice_lines
for select using (
  invoice_id in (select public.user_readable_invoice_ids())
);
