-- ─────────────────────────────────────────────────────────────────────────────
-- app_0049_soften_drain_fifo.sql
--
-- Softens drain_fifo_layers(): replaces the terminal RAISE EXCEPTION on
-- cost_layers shortfall with a synthetic NULL-cost row for the uncovered
-- remainder, so stock movements can proceed even when layers are short.
--
-- ONLY CHANGE from app_0037 body:
--   The consistency guard at the bottom of the function (previously RAISE) is
--   replaced with a RETURN NEXT of a synthetic fifo_drain_row:
--     layer_id        = NULL        (no real layer was drained)
--     original_seq    = nextval(…)  (fresh global seq — assigns a new sequence
--                                    number so the shortfall lot sorts LAST in
--                                    any bucket it lands in, and satisfies the
--                                    NOT NULL constraint on transfer_cost_layers)
--     qty_consumed    = v_qty_left  (the uncovered remainder)
--     unit_cost_cents = NULL        (unknown — marks cost_known=false at callers)
--
-- Why no caller changes are needed:
--   • record_sale / record_service_usage: aggregate cost via bool_and/sum over
--     the result set. A NULL unit_cost_cents row makes bool_and → false and the
--     CASE returns NULL. Result: cogs_cents=NULL, cost_known=false. Intended.
--   • review_stock_request: loops and calls fifo_add_layer() per row. With a
--     non-null original_seq the layer is created in the holder bucket at that
--     seq with NULL cost. Holder cost stays unknown for those units.
--   • initiate_transfer: INSERTs each row into transfer_cost_layers, which has
--     original_seq NOT NULL. The nextval() satisfies that constraint; the lot
--     arrives at the destination as NULL-cost and drains last.
--   • receive_transfer / cancel_transfer: recreate or restore lots by
--     iterating transfer_cost_layers — the NULL-cost shortfall lot propagates
--     through transit correctly.
--
-- Operational note:
--   The soft path should only fire on truly legacy/uncovered stock. After
--   applying app_0048 (gap backfill), normal stock should never hit this path.
--   It remains as a last-resort safety valve rather than a routine path.
--
-- Depends on: app_0037_fifo_drain (type fifo_drain_row, cost_layers schema)
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- ── Shortfall path (CHANGED from app_0037) ─────────────────────────────────
  -- Previously: RAISE EXCEPTION when v_qty_left > 0 (hard failure on desync).
  -- Now: emit one synthetic NULL-cost row for the uncovered remainder so every
  -- caller can proceed with cost_known=false rather than failing entirely.
  --
  -- original_seq is assigned via nextval so that:
  --   (a) transfer_cost_layers.original_seq NOT NULL constraint is satisfied, and
  --   (b) the synthetic lot sorts LAST in any bucket (highest seq = newest lot).
  -- unit_cost_cents = NULL propagates through all callers unchanged.
  -- layer_id = NULL identifies this row as synthetic (no real layer was drained).
  if v_qty_left > 0 then
    v_result.layer_id        := null;
    v_result.original_seq    := nextval('public.cost_layer_seq');
    v_result.qty_consumed    := v_qty_left;
    v_result.unit_cost_cents := null;
    return next v_result;
  end if;
end;
$$;

-- Internal helper — never callable directly by authenticated users.
revoke all on function public.drain_fifo_layers(uuid, uuid, uuid, uuid, integer) from public;
