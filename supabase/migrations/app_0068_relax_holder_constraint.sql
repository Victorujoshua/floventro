-- ─────────────────────────────────────────────────────────────────────────────
-- app_0068_relax_holder_constraint.sql
--
-- Relaxes stock_ledger_holder_consistency so that reason='sale' may carry
-- either a NULL holder_user_id (pool sale — owner/admin selling from branch
-- pool) or a non-null holder_user_id (holding sale — sales role selling from
-- personal holding).
--
-- Before (app_0021):
--   'issue_to_holding','return_to_branch','sale','usage' → holder MUST be non-null
--   all other reasons                                   → holder MUST be null
--
-- After:
--   'issue_to_holding','return_to_branch','usage' → holder MUST be non-null
--   'sale'                                        → holder may be null OR non-null
--   all other reasons                             → holder MUST be null
--
-- Safety:
--   Existing holding-sale rows have holder_user_id IS NOT NULL — the new
--   constraint still passes them (reason='sale' branch allows any value).
--   No data migration required.
--
-- Depends on: app_0021_ledger_holder (defines stock_ledger_holder_consistency)
--             app_0051_fulfilment_costing (last to touch stock_ledger constraints)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.stock_ledger
  drop constraint stock_ledger_holder_consistency;

alter table public.stock_ledger
  add constraint stock_ledger_holder_consistency
  check (
    -- These reasons ALWAYS require a personal holder.
    (reason in ('issue_to_holding', 'return_to_branch', 'usage')
     and holder_user_id is not null)
    or
    -- 'sale' allows either: pool (NULL) or personal holding (non-null).
    (reason = 'sale')
    or
    -- All other reasons (vendor_invoice, transfer_*, request_fulfilment,
    -- adjustment, reversal, return_receipt, fulfilment_out, fulfilment_return)
    -- must have no holder (branch / pool movement only).
    (reason not in ('issue_to_holding', 'return_to_branch', 'usage', 'sale')
     and holder_user_id is null)
  );
