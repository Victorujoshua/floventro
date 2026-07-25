-- ─────────────────────────────────────────────────────────────────────────────
-- app_0033_costing_schema.sql
--
-- Adds the two tables that underpin the inventory costing engine:
--
--   product_cost_state  — running weighted-average cost per (branch, holder, product).
--                         Mirrors the (branch, holder, product) keying of
--                         staff_holdings / product_stock, so the cost state
--                         shadows the stock-position model 1:1.
--
--   cogs_allocations    — immutable COGS record frozen at each consumption event
--                         (sale line or service consumption).  One row per line.
--                         History is never recomputed — this is what makes a
--                         prospective costing-method change safe.
--
-- SCHEMA ONLY — no RPC touches these tables yet.
-- Zero behavioral change on apply.
--
-- Depends on: app_0001_core (organisations, branches, set_updated_at)
--             app_0011_stock_rls (user_vendor_read_branch_ids helper)
--             app_0022_staff_holdings (establishes the holder model)
--             app_0032_vat_wht (costing_method column on organisations)
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- Table: product_cost_state
-- ─────────────────────────────────────────────────────────────────────────────

create table public.product_cost_state (
  id               uuid        primary key default gen_random_uuid(),
  organisation_id  uuid        not null references public.organisations(id) on delete restrict,
  branch_id        uuid        not null references public.branches(id)      on delete restrict,
  -- NULL = branch pool (mirrors product_stock); set = staff personal holding (mirrors staff_holdings).
  holder_user_id   uuid        references auth.users(id),
  product_id       uuid        not null references public.products(id)      on delete restrict,
  -- quantity must stay non-negative; engine zeroes the row rather than going negative.
  quantity         integer     not null default 0 check (quantity >= 0),
  -- avg_cost_cents: weighted-average unit cost in the smallest currency unit.
  -- NULL = cost basis is unknown (units entered via opening-stock with no cost given).
  -- Never stored as 0 — 0 would imply free goods; NULL means "we don't know".
  avg_cost_cents   bigint,
  -- Carried alongside avg for exactness across accumulation steps.
  -- NULL when avg_cost_cents is NULL.
  total_cost_cents bigint,
  updated_at       timestamptz not null default now()
);

-- Trigger keeps updated_at current on every engine write.
create trigger product_cost_state_updated_at
  before update on public.product_cost_state
  for each row execute function public.set_updated_at();

-- Uniqueness: one row per bucket (branch × holder × product).
-- Two partial indexes rather than one composite because Postgres treats NULLs as
-- distinct in a normal unique index, so (branch, NULL, product) would not dedupe.

-- Branch-pool bucket (holder IS NULL).
create unique index product_cost_state_bucket_pool
  on public.product_cost_state (branch_id, product_id)
  where holder_user_id is null;

-- Staff-holding bucket (holder IS NOT NULL).
create unique index product_cost_state_bucket_holder
  on public.product_cost_state (branch_id, holder_user_id, product_id)
  where holder_user_id is not null;

create index product_cost_state_org_idx     on public.product_cost_state (organisation_id);
create index product_cost_state_product_idx on public.product_cost_state (product_id);


-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.product_cost_state enable row level security;

-- SELECT: any member who can read stock in a branch can read its cost state.
-- Uses the same helper as product_stock / stock_ledger SELECT policies.
create policy "product_cost_state_select"
  on public.product_cost_state
  for select
  using (
    branch_id in (select public.user_vendor_read_branch_ids())
  );

-- No INSERT / UPDATE / DELETE policies.
-- All writes are reserved for security-definer RPCs (1c-ii onwards).
-- Absence of a write policy denies direct writes at the database layer.


-- ─────────────────────────────────────────────────────────────────────────────
-- Table: cogs_allocations
-- ─────────────────────────────────────────────────────────────────────────────

create table public.cogs_allocations (
  id              uuid        primary key default gen_random_uuid(),
  organisation_id uuid        not null references public.organisations(id) on delete restrict,
  branch_id       uuid        not null references public.branches(id)      on delete restrict,
  product_id      uuid        not null references public.products(id)      on delete restrict,
  -- What event generated this COGS line.
  reference_type  text        not null check (reference_type in ('sale_line', 'service_consumption')),
  reference_id    uuid        not null,   -- sale_line.id or service_consumption.id
  quantity        integer     not null check (quantity > 0),
  -- cogs_cents: frozen at consumption time; NULL when cost basis was unknown.
  cogs_cents      bigint,
  -- cost_known = false when any consumed unit lacked a cost basis (opening stock).
  -- In that case cogs_cents is NULL and margin reporting shows "—".
  cost_known      boolean     not null default true,
  -- Records the method that actually produced this number.
  -- Honest about fallbacks: if the org chose 'fifo' but only weighted is built,
  -- this stores 'weighted'.
  method_used     text        not null check (method_used in ('weighted', 'fifo')),
  created_at      timestamptz not null default now()
);

-- cogs_allocations is append-only; no updated_at needed.

create index cogs_allocations_ref_idx     on public.cogs_allocations (reference_type, reference_id);
create index cogs_allocations_product_idx on public.cogs_allocations (product_id);
create index cogs_allocations_branch_idx  on public.cogs_allocations (branch_id);
create index cogs_allocations_org_idx     on public.cogs_allocations (organisation_id);


-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.cogs_allocations enable row level security;

-- SELECT: branch-read access is sufficient (COGS data is not more sensitive than
-- stock or sales data the same user can already read).
create policy "cogs_allocations_select"
  on public.cogs_allocations
  for select
  using (
    branch_id in (select public.user_vendor_read_branch_ids())
  );

-- No INSERT / UPDATE / DELETE policies.
-- Rows are created exclusively by security-definer RPCs when recording sales /
-- service consumption (1c-ii onwards). Append-only by design — no updates.
