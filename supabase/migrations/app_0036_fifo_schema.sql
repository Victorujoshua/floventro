-- ─────────────────────────────────────────────────────────────────────────────
-- app_0036_fifo_schema.sql
--
-- Adds the two tables that underpin the FIFO costing engine:
--
--   cost_layers          — one row per cost lot per bucket (branch × holder × product).
--                          Lots drain oldest-first by original_seq (global FIFO order).
--                          Coexists with product_cost_state; both are maintained in
--                          parallel — the org's costing_method decides which drives COGS.
--
--   transfer_cost_layers — snapshot of drained layers carried on a transfer line while
--                          stock is in transit. Written at initiate_transfer; read by
--                          receive_transfer (recreate at dest) and cancel_transfer
--                          (restore to source). Cascades with the transfer line.
--
-- SCHEMA ONLY — no RPC touches these tables yet.
-- Zero behavioral change on apply.
--
-- Key design decisions:
--
--   original_seq (bigint, from cost_layer_seq):
--     Assigned ONCE when stock first enters the system (at vendor receipt, opening
--     adjustment, etc.). CARRIED UNCHANGED through every move — pool→holding,
--     inter-branch transfer, return to pool. This is what makes FIFO global: a
--     January lot keeps its January seq even after being issued to a holder in March;
--     it still drains before a February lot in any bucket it lands in. A per-bucket
--     sequence would produce per-bucket FIFO (which is weaker and surprising).
--
--   Dedicated sequence (cost_layer_seq):
--     A bigint sequence is monotonic, collision-free across concurrent transactions,
--     and requires no coordination. Alternatives considered: using stock_ledger row
--     insertion order (not a stable bigint sequence; depends on ledger schema) or
--     created_at timestamps (not collision-free under concurrent receipts of the same
--     product). Dedicated sequence is cleaner.
--
--   Exhausted layers (qty_remaining = 0) are retained as audit rows.
--     Partial indexes filter them out of the drain path. No DELETE on drain.
--
--   transfer_cost_layers carries organisation_id:
--     The table has no branch_id column, so the standard branch-read RLS helper
--     cannot be applied directly. Adding organisation_id allows an efficient EXISTS
--     subquery policy that mirrors the lockdown on the other costing tables without
--     an expensive three-way join at every row read.
--
-- Depends on: app_0001_core (organisations, branches)
--             app_0011_stock_rls (user_vendor_read_branch_ids helper)
--             app_0022_staff_holdings (establishes the holder model)
--             app_0028_transfers (stock_transfer_lines)
--             app_0033_costing_schema (establishes coexistence pattern)
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- Sequence: cost_layer_seq
-- ─────────────────────────────────────────────────────────────────────────────
-- Monotonic bigint used as original_seq. nextval() called exactly once per new
-- lot that enters the system (at receipt, opening, or adjustment); never called
-- when an existing layer is moved. Shared across the entire database — sequences
-- are always global in Postgres — which guarantees strict global ordering even
-- under concurrent inflows across branches.

create sequence public.cost_layer_seq;


-- ─────────────────────────────────────────────────────────────────────────────
-- Table: cost_layers
-- ─────────────────────────────────────────────────────────────────────────────

create table public.cost_layers (
  id              uuid        primary key default gen_random_uuid(),
  organisation_id uuid        not null references public.organisations(id) on delete restrict,
  branch_id       uuid        not null references public.branches(id)      on delete restrict,
  -- NULL = branch pool (mirrors product_stock).
  -- set  = staff personal holding (mirrors staff_holdings).
  holder_user_id  uuid        references auth.users(id),
  product_id      uuid        not null references public.products(id)      on delete restrict,
  -- original_seq: assigned at first system entry via nextval('cost_layer_seq').
  -- NEVER CHANGED after creation — carried through every move. Drives FIFO order.
  original_seq    bigint      not null,
  -- qty_remaining: starts at the received quantity; decrements on each FIFO drain.
  -- Reaches 0 when fully consumed. Row is kept (not deleted) for audit history.
  -- Excluded from the drain path by the partial indexes (qty_remaining > 0).
  qty_remaining   integer     not null check (qty_remaining >= 0),
  -- unit_cost_cents: cost per unit for this lot.
  -- NULL = unknown (e.g. opening stock with no cost given). FIFO COGS for an
  -- unknown-cost layer is NULL, not zero. Never store 0 to mean "unknown".
  unit_cost_cents bigint,
  -- What event created this layer.
  source_ref_type text        check (source_ref_type in (
    'vendor_invoice',   -- received from vendor (receive_invoice_stock)
    'issue_to_holding', -- pool layer split when issued to staff (review_stock_request)
    'transfer_in',      -- arrived from another branch (receive_transfer)
    'return',           -- returned from holding to pool (return_to_branch)
    'opening',          -- synthetic layer created at weighted→fifo transition
    'adjustment'        -- stock adjustment entry
  )),
  source_ref_id   uuid,
  created_at      timestamptz not null default now()
  -- No updated_at — original_seq and unit_cost_cents are immutable after creation;
  -- qty_remaining is the only mutable field and is maintained by security-definer RPCs.
);


-- ── Drain-order indexes ───────────────────────────────────────────────────────
-- Partial: only active layers (qty_remaining > 0). Exhausted rows excluded.
-- ORDER BY original_seq ASC → oldest lot first → true global FIFO.

-- Branch-pool bucket (holder IS NULL):
create index cost_layers_bucket_pool_idx
  on public.cost_layers (branch_id, product_id, original_seq)
  where holder_user_id is null and qty_remaining > 0;

-- Staff-holding bucket (holder IS NOT NULL):
create index cost_layers_bucket_holder_idx
  on public.cost_layers (branch_id, holder_user_id, product_id, original_seq)
  where holder_user_id is not null and qty_remaining > 0;

-- Supporting indexes for org-level reporting and product lookups.
create index cost_layers_org_idx     on public.cost_layers (organisation_id);
create index cost_layers_product_idx on public.cost_layers (product_id);


-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.cost_layers enable row level security;

-- SELECT: any member who can read stock in a branch can read its cost layers.
-- Uses the same helper as product_cost_state / cogs_allocations SELECT policies.
create policy "cost_layers_select"
  on public.cost_layers
  for select
  using (
    branch_id in (select public.user_vendor_read_branch_ids())
  );

-- No INSERT / UPDATE / DELETE policies.
-- All writes are reserved for security-definer RPCs (step 2b onwards).
-- Absence of a write policy denies direct writes at the database layer.


-- ─────────────────────────────────────────────────────────────────────────────
-- Table: transfer_cost_layers
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per drained lot per transfer line. Written at initiate_transfer,
-- read at receive_transfer / cancel_transfer, cascades on line deletion.
--
-- Carries the original_seq of each drained layer so the destination recreates
-- the lots in the correct global FIFO order (not re-numbered at arrival).

create table public.transfer_cost_layers (
  id               uuid        primary key default gen_random_uuid(),
  -- organisation_id is denormalised here for efficient RLS: transfer_cost_layers
  -- has no branch_id column, so the standard branch-read helper cannot be applied
  -- directly. This column allows a single EXISTS subquery policy with no joins.
  organisation_id  uuid        not null references public.organisations(id) on delete restrict,
  transfer_line_id uuid        not null references public.stock_transfer_lines(id) on delete cascade,
  -- original_seq preserved from the source layer — NOT reassigned on arrival.
  -- This is what allows the destination to honour global FIFO order.
  original_seq     bigint      not null,
  -- quantity: the number of units drained from this lot for this transfer line.
  quantity         integer     not null check (quantity > 0),
  -- unit_cost_cents: the cost of this lot. NULL = unknown (source lot was unknown).
  unit_cost_cents  bigint,
  created_at       timestamptz not null default now()
);

create index transfer_cost_layers_line_idx on public.transfer_cost_layers (transfer_line_id);


-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.transfer_cost_layers enable row level security;

-- SELECT: any member who can read at least one branch in this organisation can
-- read its in-transit layer snapshots. The EXISTS subquery is efficient because
-- user_vendor_read_branch_ids() returns a small set (branches in the user's org).
create policy "transfer_cost_layers_select"
  on public.transfer_cost_layers
  for select
  using (
    exists (
      select 1
        from public.branches
       where organisation_id = transfer_cost_layers.organisation_id
         and id in (select public.user_vendor_read_branch_ids())
    )
  );

-- No INSERT / UPDATE / DELETE policies.
-- Written exclusively by FIFO-enabled initiate_transfer / receive_transfer /
-- cancel_transfer (step 2b onwards). Append-only by design (cascade handles cleanup).
