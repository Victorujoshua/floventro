-- ─────────────────────────────────────────────────────────────────────────────
-- app_0041_fifo_return.sql
--
-- Fixes return_to_branch: adds FIFO cost_layers move (holder → pool) to match
-- the existing weighted product_cost_state move, so both engines stay in sync
-- after every return.
--
-- Gap closed:
--   Before this migration, return_to_branch moved product_cost_state holder→pool
--   but left cost_layers untouched. After a return, cost_layers.qty_remaining in
--   the holder bucket was too high and the pool bucket was short — the two engines
--   disagreed on quantity, breaking the consistency check and causing the next
--   drain_fifo_layers call on that holder to over-drain (or the pool to be short).
--
-- Pattern used (mirrors review_stock_request pool→holder, reversed):
--   drain_fifo_layers(holder bucket)  →  fifo_add_layer(pool bucket, carry seq)
--
-- original_seq is CARRIED unchanged — returned stock keeps its global FIFO age.
-- A January lot returned to pool in March is still January-aged in pool; it will
-- drain before any February or March arrivals.
--
-- source_ref_type = 'return'. source_ref_id = null (return_to_branch has no
-- dedicated return-document id; event is traceable via cost_layers.created_at
-- and source_ref_type).
--
-- Runs regardless of costing_method (Option A: both engines always maintained).
--
-- Lock order (consistent with all RPCs):
--   staff_holdings FOR UPDATE
--     → product_cost_state (holder) FOR UPDATE
--       → product_cost_state (pool) FOR UPDATE
--         → cost_layers (holder) FOR UPDATE  [inside drain_fifo_layers]
--         → cost_layers (pool) INSERT        [inside fifo_add_layer]
--
-- Note on pre-existing lock ordering:
--   return_to_branch acquires holder cost_state before pool cost_state.
--   review_stock_request acquires pool cost_state before holder cost_state.
--   This crossed ordering is a pre-existing condition from app_0035 (could
--   deadlock under concurrent return + issue of same product by same user).
--   Not introduced by this migration; cost_layers locks are always last in both.
--
-- Depends on:
--   app_0035_costing_outflows  (function being replaced)
--   app_0037_fifo_drain        (drain_fifo_layers, fifo_drain_row)
--   app_0038_fifo_inflows      (fifo_add_layer)
-- ─────────────────────────────────────────────────────────────────────────────


create or replace function public.return_to_branch(
  p_branch_id  uuid,
  p_product_id uuid,
  p_quantity   integer,
  p_note       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid    := auth.uid();
  v_org_id     uuid;
  v_held       integer;
  -- weighted cost-state accumulators (unchanged from app_0035)
  v_holder_qty   integer;
  v_holder_avg   bigint;
  v_holder_total bigint;
  v_pool_qty     integer;
  v_pool_avg     bigint;
  v_pool_total   bigint;
  v_move_cost    bigint;
  v_new_qty      integer;
  v_new_total    bigint;
  v_new_avg      bigint;
  -- ── NEW (FIFO) ────────────────────────────────────────────────────────────
  v_fifo_row     public.fifo_drain_row;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than 0';
  end if;

  select organisation_id into v_org_id
    from public.branches
   where id = p_branch_id
     and deleted_at is null;

  if v_org_id is null then
    raise exception 'branch not found';
  end if;

  if p_branch_id not in (select public.user_vendor_read_branch_ids()) then
    raise exception 'not authorised to return stock in this branch';
  end if;

  if not exists (
    select 1
      from public.products
     where id              = p_product_id
       and organisation_id = v_org_id
       and deleted_at      is null
  ) then
    raise exception 'product not found in this organisation';
  end if;

  -- FOR UPDATE on staff_holdings. Holder cost-state lock follows.
  select coalesce(quantity, 0) into v_held
    from public.staff_holdings
   where branch_id      = p_branch_id
     and holder_user_id = v_user_id
     and product_id     = p_product_id
   for update;

  if coalesce(v_held, 0) < p_quantity then
    raise exception
      'insufficient holding for product % (holding: %, returning: %)',
      p_product_id, coalesce(v_held, 0), p_quantity;
  end if;

  -- ── weighted: read and lock holder cost bucket ────────────────────────────
  -- staff_holdings already locked above; holder cost-state follows (consistent order).
  select quantity, avg_cost_cents, total_cost_cents
    into v_holder_qty, v_holder_avg, v_holder_total
    from public.product_cost_state
   where branch_id      = p_branch_id
     and holder_user_id = v_user_id
     and product_id     = p_product_id
   for update;

  v_holder_qty := coalesce(v_holder_qty, 0);
  -- Units leave holding at the holder's avg. NULL avg → unknown, propagates to pool.
  v_move_cost  := case when v_holder_avg is not null then p_quantity * v_holder_avg else null end;

  insert into public.stock_ledger (
    organisation_id, branch_id, product_id, quantity_delta,
    reason, reference_type, reference_id, holder_user_id, note, created_by
  ) values (
    v_org_id, p_branch_id, p_product_id, -p_quantity,
    'return_to_branch', 'staff_holding', v_user_id, v_user_id,
    nullif(trim(p_note), ''), v_user_id
  );

  update public.staff_holdings
     set quantity   = quantity - p_quantity,
         updated_at = now()
   where branch_id      = p_branch_id
     and holder_user_id = v_user_id
     and product_id     = p_product_id;

  -- ── weighted: decrement holder cost bucket ────────────────────────────────
  -- No cogs_allocations row — location change, not consumption.
  -- Removing units at avg does NOT change avg; qty → 0 resets avg→NULL, total→0.
  v_new_qty   := greatest(v_holder_qty - p_quantity, 0);
  v_new_total := case
                   when v_new_qty = 0        then 0
                   when v_holder_avg is null  then null
                   else coalesce(v_holder_total, 0) - v_move_cost
                 end;

  insert into public.product_cost_state (
    organisation_id, branch_id, holder_user_id, product_id,
    quantity, avg_cost_cents, total_cost_cents
  ) values (
    v_org_id, p_branch_id, v_user_id, p_product_id,
    v_new_qty,
    case when v_new_qty = 0 then null else v_holder_avg end,
    v_new_total
  )
  on conflict (branch_id, holder_user_id, product_id) where holder_user_id is not null
  do update set
    quantity         = excluded.quantity,
    avg_cost_cents   = excluded.avg_cost_cents,
    total_cost_cents = excluded.total_cost_cents,
    updated_at       = now();

  insert into public.stock_ledger (
    organisation_id, branch_id, product_id, quantity_delta,
    reason, reference_type, reference_id, created_by
  ) values (
    v_org_id, p_branch_id, p_product_id, p_quantity,
    'return_receipt', 'staff_holding', v_user_id, v_user_id
  );

  insert into public.product_stock (
    organisation_id, branch_id, product_id, quantity
  ) values (
    v_org_id, p_branch_id, p_product_id, p_quantity
  )
  on conflict (branch_id, product_id)
  do update
    set quantity   = product_stock.quantity + excluded.quantity,
        updated_at = now();

  -- ── weighted: increment pool cost bucket at holder avg ────────────────────
  -- product_stock upsert above implicitly locks that row; pool cost-state follows.
  -- Weighted-average the returning units into pool at their carried cost.
  -- Unknown propagates; tainted pool stays NULL.
  select quantity, avg_cost_cents, total_cost_cents
    into v_pool_qty, v_pool_avg, v_pool_total
    from public.product_cost_state
   where branch_id      = p_branch_id
     and product_id     = p_product_id
     and holder_user_id is null
   for update;

  v_pool_qty := coalesce(v_pool_qty, 0);
  v_new_qty  := v_pool_qty + p_quantity;

  if v_move_cost is null then
    -- Returning units had unknown cost; propagate unknown to pool.
    v_new_total := null;
    v_new_avg   := null;
  elsif v_pool_qty > 0 and v_pool_avg is null then
    -- Pool is tainted; cannot blend known-cost returns.
    v_new_total := null;
    v_new_avg   := null;
  else
    v_new_total := coalesce(v_pool_total, 0) + v_move_cost;
    v_new_avg   := v_new_total / v_new_qty;
  end if;

  insert into public.product_cost_state (
    organisation_id, branch_id, holder_user_id, product_id,
    quantity, avg_cost_cents, total_cost_cents
  ) values (
    v_org_id, p_branch_id, null, p_product_id,
    v_new_qty, v_new_avg, v_new_total
  )
  on conflict (branch_id, product_id) where holder_user_id is null
  do update set
    quantity         = excluded.quantity,
    avg_cost_cents   = excluded.avg_cost_cents,
    total_cost_cents = excluded.total_cost_cents,
    updated_at       = now();
  -- ── END weighted ──────────────────────────────────────────────────────────

  -- ── NEW (FIFO): move layers holder → pool, carrying original_seq ──────────
  -- Mirrors review_stock_request (pool→holder drain+add) but reversed.
  -- drain_fifo_layers takes p_quantity units from the holder bucket oldest-first;
  -- fifo_add_layer recreates each lot in the pool bucket at the SAME original_seq.
  -- A January lot returned in March remains January-aged in pool — FIFO order
  -- is preserved globally regardless of when the return happens.
  --
  -- cost_layers FOR UPDATE is acquired here, after both product_cost_state locks
  -- above — consistent with the global lock order (cost_layers always last).
  -- Runs regardless of costing_method (Option A: both engines always maintained).
  for v_fifo_row in
    select * from public.drain_fifo_layers(
      v_org_id,
      p_branch_id,
      v_user_id,                -- drain from returner's holder bucket
      p_product_id,
      p_quantity
    )
  loop
    perform public.fifo_add_layer(
      v_org_id,
      p_branch_id,
      null,                          -- recreate in pool bucket
      p_product_id,
      v_fifo_row.qty_consumed,
      v_fifo_row.unit_cost_cents,    -- carry cost; NULL propagates as-is
      v_fifo_row.original_seq,       -- CARRY seq — never regenerate on a move
      'return',
      null                           -- no dedicated return document id
    );
  end loop;
  -- ── END NEW (FIFO) ────────────────────────────────────────────────────────

end;
$$;

revoke all    on function public.return_to_branch(uuid, uuid, integer, text) from public;
grant execute on function public.return_to_branch(uuid, uuid, integer, text) to authenticated;
