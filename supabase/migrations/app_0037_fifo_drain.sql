-- ─────────────────────────────────────────────────────────────────────────────
-- app_0037_fifo_drain.sql
--
-- Adds drain_fifo_layers() — the single reusable core of the FIFO engine.
-- Every FIFO outflow (sale, service usage, issue-to-holding, transfer-out)
-- calls this helper. It only drains cost_layers and returns the lot breakdown;
-- it does NOT write cogs_allocations, does NOT move product_stock, does NOT
-- update staff_holdings. Callers own those decisions.
--
-- Return shape (SETOF fifo_drain_row):
--   One row per drained lot. Callers aggregate for total COGS or INSERT the rows
--   directly into transfer_cost_layers for in-transit tracking. This is the
--   composable pattern: aggregate with SUM for sales/service, INSERT…SELECT for
--   transfers — no jsonb serialisation, no intermediate variables.
--
-- Drain mechanics:
--   Iterates active layers (qty_remaining > 0) in original_seq ASC order —
--   oldest lot first, global FIFO. Locks rows FOR UPDATE (serialises concurrent
--   drains of the same bucket; never skips locked rows — a skip would cause two
--   concurrent sales to consume from different lots simultaneously, undermining
--   FIFO). Decrements qty_remaining on each drained lot. Exhausted lots reach
--   qty_remaining = 0 and remain as audit rows; the partial index excludes them
--   from future drain scans automatically.
--
-- Raises if the bucket cannot cover p_quantity — insufficient layers means
-- stock and cost_layers are inconsistent. Surfacing this immediately is safer
-- than silently producing a wrong (partial) COGS figure.
--
-- NULL / unknown semantics:
--   A lot with unit_cost_cents NULL = unknown cost. The drain proceeds normally;
--   the returned row carries unit_cost_cents NULL. Callers detect unknown-cost
--   lots via bool_and(unit_cost_cents is not null) over the result set.
--   COGS for a fully-unknown drain = NULL (not zero). Partial unknown (some lots
--   known, some not) = NULL for the aggregate — callers must check per-lot.
--
-- Security:
--   SECURITY DEFINER — required because cost_layers has no user-write RLS
--   policies (RPC-only writes). The function must run as its owner (postgres)
--   to UPDATE qty_remaining. It is NOT granted to authenticated users; it is an
--   internal helper invoked only by other security-definer RPCs.
--
-- Depends on: app_0036_fifo_schema (cost_layers, cost_layer_seq)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Composite return type ─────────────────────────────────────────────────────
-- One row per drained lot.
-- layer_id     — cost_layers.id; lets callers trace exactly which lot was drained.
-- original_seq — the lot's global FIFO sequence, carried through all moves.
--                Preserved into transfer_cost_layers so the destination recreates
--                lots in the correct order.
-- qty_consumed — units taken from this lot (may be < lot's original qty if
--                the lot was partially drained, or the drain satisfied mid-lot).
-- unit_cost_cents — per-unit cost of this lot; NULL = unknown cost.

create type public.fifo_drain_row as (
  layer_id        uuid,
  original_seq    bigint,
  qty_consumed    integer,
  unit_cost_cents bigint
);


-- ── drain_fifo_layers ─────────────────────────────────────────────────────────

create or replace function public.drain_fifo_layers(
  p_org_id         uuid,
  p_branch_id      uuid,
  p_holder_user_id uuid,     -- NULL = branch pool; non-null = staff holding
  p_product_id     uuid,
  p_quantity       integer   -- total units to drain; must be > 0
) returns setof public.fifo_drain_row
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layer    public.cost_layers%rowtype;
  v_qty_left integer := p_quantity;
  v_consume  integer;
  v_result   public.fifo_drain_row;
begin
  -- ── Guard ──────────────────────────────────────────────────────────────────
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'drain_fifo_layers: p_quantity must be > 0 (got %)', p_quantity;
  end if;

  -- ── Drain loop ─────────────────────────────────────────────────────────────
  -- Locks active lots FOR UPDATE in original_seq ASC (oldest-first = FIFO).
  -- No SKIP LOCKED — concurrent drains of the same bucket must serialise, not
  -- diverge onto different lots.
  --
  -- holder_user_id comparison uses IS NOT DISTINCT FROM so that NULL = NULL
  -- (pool bucket) matches correctly — standard = returns NULL for NULL operands.
  for v_layer in
    select *
      from public.cost_layers
     where organisation_id  = p_org_id
       and branch_id        = p_branch_id
       and holder_user_id   is not distinct from p_holder_user_id
       and product_id       = p_product_id
       and qty_remaining    > 0
     order by original_seq asc, created_at asc, id asc
     for update
  loop
    exit when v_qty_left = 0;

    -- Take as much as this lot has, up to what we still need.
    v_consume := least(v_layer.qty_remaining, v_qty_left);

    -- Decrement. Lot reaches 0 and stays as an audit row; the partial index
    -- (qty_remaining > 0) excludes it from all future drain scans.
    update public.cost_layers
       set qty_remaining = qty_remaining - v_consume
     where id = v_layer.id;

    -- Emit one result row per lot touched.
    v_result.layer_id        := v_layer.id;
    v_result.original_seq    := v_layer.original_seq;
    v_result.qty_consumed    := v_consume;
    v_result.unit_cost_cents := v_layer.unit_cost_cents;   -- NULL propagates as-is
    return next v_result;

    v_qty_left := v_qty_left - v_consume;
  end loop;

  -- ── Consistency guard ──────────────────────────────────────────────────────
  -- If layers ran out before p_quantity was satisfied, cost_layers and the stock
  -- position are inconsistent. Raise immediately — a partial drain producing a
  -- silently wrong COGS is worse than a visible error.
  if v_qty_left > 0 then
    raise exception
      'drain_fifo_layers: cost_layers exhausted before satisfying drain — '
      'product %, branch %, holder %, needed %, short by %. '
      'stock and cost_layers are out of sync.',
      p_product_id, p_branch_id, p_holder_user_id, p_quantity, v_qty_left;
  end if;
end;
$$;

-- Internal helper — never callable directly by authenticated users.
-- Security-definer callers (owned by postgres) can invoke it via owner privilege;
-- no explicit EXECUTE grant to authenticated is needed or wanted.
revoke all on function public.drain_fifo_layers(uuid, uuid, uuid, uuid, integer) from public;


-- ── Caller patterns (non-normative; shown here for reference) ─────────────────
--
-- A. Sales / service usage — want total COGS and whether all cost is known:
--
--   select
--     case
--       when bool_and(d.unit_cost_cents is not null)
--         then sum(d.qty_consumed * d.unit_cost_cents)
--       else null                    -- any unknown lot → COGS unknown
--     end                                         as total_cogs_cents,
--     bool_and(d.unit_cost_cents is not null)     as cost_known
--   into v_cogs_cents, v_cost_known
--   from public.drain_fifo_layers(v_org_id, p_branch_id, v_user_id,
--                                  v_product_id, v_qty) d;
--
-- B. initiate_transfer — snapshot drained lots into transfer_cost_layers:
--
--   insert into public.transfer_cost_layers
--     (organisation_id, transfer_line_id, original_seq, quantity, unit_cost_cents)
--   select v_org_id, v_xfer_line_id,
--          d.original_seq, d.qty_consumed, d.unit_cost_cents
--     from public.drain_fifo_layers(v_org_id, p_source_branch_id, null,
--                                    v_product_id, v_qty) d;
--
-- C. review_stock_request — drain pool bucket, then recreate as holder layers:
--   (same as A for cost total; the holder-layer creation is a separate write by
--    the caller — drain_fifo_layers only removes from the source bucket)
