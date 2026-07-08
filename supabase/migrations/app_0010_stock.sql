-- Migration: app_0010_stock
-- Introduces four tables for stock tracking:
--   product_stock       — cached on-hand quantity per product per branch (fast reads)
--   stock_ledger        — append-only movement history (the authoritative source of truth)
--   vendor_invoices     — invoice headers (on-terms; tracks outstanding balance)
--   vendor_invoice_lines — invoice line items (products + quantities + costs)
--
-- Design rules enforced here:
--   - All money stored as bigint (cents). All quantities as integer (whole units).
--   - stock_ledger is immutable: no updated_at, no deleted_at, no user write policies.
--   - product_stock is a cached derivative; only the security-definer RPC (Task 3.2) writes it.
--   - All FK references use ON DELETE RESTRICT to preserve stock history.
--     The sole exception is vendor_invoice_lines.invoice_id → vendor_invoices,
--     which uses ON DELETE CASCADE so lines cannot exist without a header.
--
-- Depends on: app_0001_core.sql (organisations, branches, set_updated_at)
--             app_0006_products.sql (products)
--             app_0008_vendors.sql  (vendors)

-- ── product_stock ────────────────────────────────────────────────────────────
-- Cached on-hand quantity. Written ONLY by security-definer RPCs.
-- Never UPDATE this table directly from application code.

create table public.product_stock (
  id               uuid        primary key default gen_random_uuid(),
  organisation_id  uuid        not null references public.organisations(id) on delete restrict,
  branch_id        uuid        not null references public.branches(id)       on delete restrict,
  product_id       uuid        not null references public.products(id)       on delete restrict,
  quantity         integer     not null default 0,
  updated_at       timestamptz not null default now(),
  unique (branch_id, product_id)
);

create trigger product_stock_updated_at
  before update on public.product_stock
  for each row execute function public.set_updated_at();

create index product_stock_branch_product_idx
  on public.product_stock (branch_id, product_id);

-- ── stock_ledger ─────────────────────────────────────────────────────────────
-- Append-only movement log. Written ONLY by security-definer RPCs.
-- Corrections are made by inserting a reversing entry (reason = 'reversal'),
-- NEVER by updating or deleting existing rows.

create table public.stock_ledger (
  id               uuid        primary key default gen_random_uuid(),
  organisation_id  uuid        not null references public.organisations(id) on delete restrict,
  branch_id        uuid        not null references public.branches(id)       on delete restrict,
  product_id       uuid        not null references public.products(id)       on delete restrict,
  quantity_delta   integer     not null,
  reason           text        not null check (reason in (
                                 'vendor_invoice',
                                 'sale',
                                 'usage',
                                 'transfer_in',
                                 'transfer_out',
                                 'request_fulfilment',
                                 'adjustment',
                                 'reversal'
                               )),
  reference_type   text,
  reference_id     uuid,
  unit_cost_cents  bigint,
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid        references auth.users(id)
  -- Intentionally no updated_at, no deleted_at.
  -- This table is immutable after insert.
);

create index stock_ledger_branch_product_time_idx
  on public.stock_ledger (branch_id, product_id, created_at);

create index stock_ledger_reference_idx
  on public.stock_ledger (reference_type, reference_id);

-- ── vendor_invoices ──────────────────────────────────────────────────────────
-- Invoice header. Tracks outstanding balance (total_cents - amount_paid_cents).
-- status transitions: unpaid → partial → paid (driven by payment recording in Phase 3+).

create table public.vendor_invoices (
  id                uuid        primary key default gen_random_uuid(),
  organisation_id   uuid        not null references public.organisations(id) on delete restrict,
  branch_id         uuid        not null references public.branches(id)       on delete restrict,
  vendor_id         uuid        not null references public.vendors(id)        on delete restrict,
  invoice_number    text,
  invoice_date      date        not null default current_date,
  due_date          date,
  total_cents       bigint      not null default 0,
  amount_paid_cents bigint      not null default 0,
  status            text        not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid')),
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  created_by        uuid        references auth.users(id)
);

create trigger vendor_invoices_updated_at
  before update on public.vendor_invoices
  for each row execute function public.set_updated_at();

create index vendor_invoices_branch_vendor_idx
  on public.vendor_invoices (branch_id, vendor_id);

create index vendor_invoices_branch_status_idx
  on public.vendor_invoices (branch_id, status)
  where deleted_at is null;

-- ── vendor_invoice_lines ─────────────────────────────────────────────────────
-- Line items belonging to a vendor invoice.
-- ON DELETE CASCADE from vendor_invoices: lines cannot exist without a header.
-- All other FKs are RESTRICT to prevent orphaned references.

create table public.vendor_invoice_lines (
  id               uuid    primary key default gen_random_uuid(),
  invoice_id       uuid    not null references public.vendor_invoices(id) on delete cascade,
  product_id       uuid    not null references public.products(id)        on delete restrict,
  quantity         integer not null check (quantity > 0),
  unit_cost_cents  bigint  not null check (unit_cost_cents >= 0),
  line_total_cents bigint  not null check (line_total_cents = quantity * unit_cost_cents)
);

create index vendor_invoice_lines_invoice_idx
  on public.vendor_invoice_lines (invoice_id);
