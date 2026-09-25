-- ─────────────────────────────────────────────────────────────────────────────
-- app_0072_formalize_receipt_columns.sql
--
-- Documentation / drift-closing migration. NOT a schema change.
--
-- vendor_invoices.receipt_status and vendor_invoice_lines.quantity_received
-- were added directly on the live database during Phase 9.1 (commits cd38bc8,
-- 583be5a) and never captured in a migration file, even though app_0029,
-- app_0034, app_0038 and app_0044 all depend on them. This file records them
-- exactly as they exist live, so a fresh database built from migrations
-- matches production.
--
-- Live definitions (read from the app project's PostgREST OpenAPI schema,
-- 2026-09-25):
--
--   vendor_invoices.receipt_status       text     NOT NULL  DEFAULT 'received'
--   vendor_invoice_lines.quantity_received integer  NULL      (no default)
--
-- Notes on the live shape:
--   • The column default is 'received', not 'pending'. record_vendor_invoice
--     always inserts 'pending' explicitly, so the default only ever applied to
--     rows that existed when the column was added — invoices from before the
--     Phase 9.1 invoice/receipt split, which moved stock at record time and so
--     were already fully received. Kept as-is; changing it is out of scope.
--   • quantity_received is NULL until the first receipt. Every reader already
--     wraps it in coalesce(quantity_received, 0).
--   • Values in use: pending | partially_received | received — the three
--     states receive_invoice_stock derives.
--
-- Re-runnable and a no-op against the live database:
--   • ADD COLUMN IF NOT EXISTS skips an existing column entirely — its type,
--     nullability and default are left untouched.
--   • The CHECK constraint is added only if no CHECK constraint mentioning
--     receipt_status already exists on vendor_invoices (whatever its name).
--
-- Depends on: app_0010_stock (vendor_invoices, vendor_invoice_lines)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. vendor_invoices.receipt_status ────────────────────────────────────────

alter table public.vendor_invoices
  add column if not exists receipt_status text not null default 'received';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.vendor_invoices'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) ilike '%receipt_status%'
  ) then
    alter table public.vendor_invoices
      add constraint vendor_invoices_receipt_status_check
      check (receipt_status in ('pending', 'partially_received', 'received'));
  end if;
end;
$$;


-- ── 2. vendor_invoice_lines.quantity_received ────────────────────────────────

alter table public.vendor_invoice_lines
  add column if not exists quantity_received integer;
