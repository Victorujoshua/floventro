-- ─────────────────────────────────────────────────────────────────────────────
-- app_0015_requests.sql
-- Stock request tables: header + lines.
--
-- Design rules:
--   - Sales and Internal Use staff raise requests; Inventory/Owner review.
--   - Approval is immediate stock movement — no separate handover step.
--   - Partial fulfilment is supported: quantity_approved may be less than
--     quantity_requested, and 0 means the line is rejected.
--   - Status is set by the review_stock_request RPC (app_0016), not by
--     direct UPDATE from application code (the RLS update policy restricts
--     direct updates to cancellation only).
--   - stock_ledger already carries 'request_fulfilment' in its reason enum
--     (app_0010) — no schema change to ledger is needed.
--
-- Depends on: app_0001_core (organisations, branches, set_updated_at)
--             app_0006_products (products)
--             app_0010_stock (stock_ledger — for the reason enum reference)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── stock_requests ────────────────────────────────────────────────────────────
-- One row per request raised by a branch member.

create table public.stock_requests (
  id               uuid        primary key default gen_random_uuid(),

  organisation_id  uuid        not null
                               references public.organisations(id) on delete restrict,
  branch_id        uuid        not null
                               references public.branches(id) on delete restrict,

  requested_by     uuid        not null
                               references auth.users(id),

  purpose          text,
  -- free text: why the stock is needed ("Client session Tues", "Restock front desk")

  status           text        not null default 'pending'
                               check (status in (
                                 'pending',
                                 'approved',
                                 'partially_approved',
                                 'rejected',
                                 'cancelled'
                               )),

  -- ── review fields ─────────────────────────────────────────────────────────
  reviewed_by      uuid        references auth.users(id),
  reviewed_at      timestamptz,
  review_note      text,
  -- inventory's note back to the requester (optional)

  -- ── audit ─────────────────────────────────────────────────────────────────
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
  -- soft-delete only; no hard DELETE policy.
);

create trigger stock_requests_updated_at
  before update on public.stock_requests
  for each row execute function public.set_updated_at();

-- Fast lookup by branch + status for the review queue (owner/inventory).
create index stock_requests_branch_status_idx
  on public.stock_requests (branch_id, status)
  where deleted_at is null;

-- Allows a user to quickly list all requests they raised (history view).
create index stock_requests_requested_by_idx
  on public.stock_requests (requested_by);

-- ── stock_request_lines ───────────────────────────────────────────────────────
-- One row per product per request.
-- quantity_approved is NULL until the request is reviewed.
-- 0 = this specific line was rejected (even if the header is 'partially_approved').

create table public.stock_request_lines (
  id                  uuid    primary key default gen_random_uuid(),

  request_id          uuid    not null
                              references public.stock_requests(id) on delete cascade,
  -- Lines are destroyed when the parent request is (soft-)deleted via cascade.

  product_id          uuid    not null
                              references public.products(id) on delete restrict,
  -- RESTRICT: preserve the line (and therefore the request history) even if
  -- the product is soft-deleted.

  quantity_requested  integer not null check (quantity_requested > 0),

  quantity_approved   integer,
  -- NULL  → not yet reviewed
  -- 0     → this line rejected by reviewer
  -- n > 0 → n units approved (may be < requested for partial fulfilment)

  -- ── quantity_approved constraints ─────────────────────────────────────────
  check (quantity_approved is null or quantity_approved >= 0),
  check (quantity_approved is null or quantity_approved <= quantity_requested)
  -- Cannot approve more than was requested. The RPC also enforces this, but
  -- the DB constraint is the definitive guard.
);

-- Single-column index on the FK; enables fast "give me all lines for request X".
create index stock_request_lines_request_idx
  on public.stock_request_lines (request_id);
