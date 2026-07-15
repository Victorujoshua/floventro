-- ─────────────────────────────────────────────────────────────────────────────
-- app_0021_ledger_holder.sql
--
-- Adds the holder dimension to stock_ledger, enabling personal stock holdings
-- for individual staff members alongside branch stock.
--
-- Model:
--   holder_user_id = NULL  → row affects branch stock (all existing rows)
--   holder_user_id = <uid> → row affects that staffer's personal holding
--
-- Two new reason values:
--   'issue_to_holding'  — stock leaves a branch, enters a staffer's holding
--   'return_to_branch'  — stock leaves a staffer's holding, returns to branch
--
-- ── PRE-APPLY CHECKS (run in Supabase SQL editor; all must pass) ─────────────
--
--   1. Confirm the reason constraint name (expected: stock_ledger_reason_check):
--      select conname
--        from pg_constraint
--       where conrelid = 'public.stock_ledger'::regclass
--         and contype  = 'c'
--         and conname  like '%reason%';
--
--      If the name returned differs from 'stock_ledger_reason_check', update the
--      DROP CONSTRAINT line in STEP 2 below before applying.
--
--   2. Confirm no 'sale' or 'usage' rows exist (required by STEP 3 constraint):
--      select reason, count(*)
--        from public.stock_ledger
--       group by reason;
--
--      The holder_consistency constraint (STEP 3) requires that any future row
--      with reason IN ('sale','usage') carries a non-null holder_user_id.
--      If any existing row has reason = 'sale' or 'usage', STOP — that ALTER
--      will be rejected. (No sales or usage features exist yet, so this should
--      return zero rows for both values.)
--
-- Depends on: app_0010_stock (stock_ledger table, original reason check)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── STEP 1: Add the holder column ────────────────────────────────────────────
--
-- Nullable — all existing rows have holder_user_id = NULL (branch stock).
-- No back-fill needed.

alter table public.stock_ledger
  add column holder_user_id uuid references auth.users(id);


-- ── STEP 2: Extend the reason CHECK constraint ───────────────────────────────
--
-- The original CHECK was defined inline in app_0010 without an explicit name.
-- PostgreSQL auto-assigned: stock_ledger_reason_check
--
-- Drop and recreate with the two new values added. The original 8 values are
-- preserved verbatim; only 'issue_to_holding' and 'return_to_branch' are new.

alter table public.stock_ledger
  drop constraint stock_ledger_reason_check;

alter table public.stock_ledger
  add constraint stock_ledger_reason_check
  check (reason in (
    'vendor_invoice',
    'sale',
    'usage',
    'transfer_in',
    'transfer_out',
    'request_fulfilment',
    'adjustment',
    'reversal',
    'issue_to_holding',
    'return_to_branch'
  ));


-- ── STEP 3: Holder consistency constraint ────────────────────────────────────
--
-- Reasons that move stock to/from a personal holding MUST carry a holder.
-- Pure branch-movement reasons MUST have holder_user_id = NULL.
--
--   Holder-bearing (non-null):
--     'issue_to_holding'  — branch → holding transfer leg
--     'return_to_branch'  — holding → branch transfer leg
--     'sale'              — consumption from holding (Phase 6.2)
--     'usage'             — consumption from holding (Phase 6.3)
--
--   Branch-only (null):
--     'vendor_invoice', 'request_fulfilment', 'adjustment',
--     'transfer_in', 'transfer_out', 'reversal'
--
-- 'sale' and 'usage' are included here because all future rows for those
-- reasons will draw from a staffer's holding — they will always carry a
-- holder_user_id. Pre-apply check 2 above confirms no existing rows use
-- these reasons, so the constraint will not reject any current data.

alter table public.stock_ledger
  add constraint stock_ledger_holder_consistency
  check (
    (reason in ('issue_to_holding', 'return_to_branch', 'sale', 'usage')
     and holder_user_id is not null)
    or
    (reason not in ('issue_to_holding', 'return_to_branch', 'sale', 'usage')
     and holder_user_id is null)
  );


-- ── STEP 4: Index for holding lookups ────────────────────────────────────────
--
-- Partial index — only rows with a holder are included. Branch-only rows
-- (holder_user_id IS NULL) are already covered by the existing
-- stock_ledger_branch_product_time_idx.

create index stock_ledger_holder_idx
  on public.stock_ledger (holder_user_id, product_id)
  where holder_user_id is not null;
