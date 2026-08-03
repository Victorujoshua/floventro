-- ─────────────────────────────────────────────────────────────────────────────
-- app_0051_fulfilment_costing.sql
--
-- Phase 1b: wires stock movement and COGS into the fulfilment lifecycle.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- What this migration does:
--   1. Expands stock_ledger.reason to allow 'fulfilment_out' and
--      'fulfilment_return' (required before the RPCs can write ledger rows).
--   2. Replaces pack_fulfilment_order with the full pool drain:
--        product_stock drain → stock_ledger → cogs_allocations → cost engines.
--   3. Replaces cancel_fulfilment_order to handle both pending (no-op) and
--        packed (pool stock + cost restoration) cancellations.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Costing invariant (Option A — both engines always maintained):
--   Regardless of org.costing_method, both product_cost_state (weighted) and
--   cost_layers (FIFO) are updated on every pack and cancel.
--   product_cost_state is ALWAYS decremented/incremented at pool_avg × qty,
--   never at the raw FIFO v_cogs value — matching the record_sale invariant.
--
-- Depends on:
--   app_0050_fulfilment_schema (fulfilment_orders, fulfilment_lines,
--                               cogs_allocations 'fulfilment_line' type,
--                               pack/cancel stubs)
--   app_0037_fifo_drain        (drain_fifo_layers — SECURITY DEFINER, not public)
--   app_0038_fifo_inflows      (fifo_add_layer   — SECURITY DEFINER, not public)
--   app_0027_return_to_branch  (stock_ledger_reason_check — last definition)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. stock_ledger.reason — add 'fulfilment_out', 'fulfilment_return'
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Live constraint name (confirmed via pg_constraint query 2026-08-03):
--   stock_ledger_reason_check
-- Current allowed values do NOT include 'fulfilment_out' or 'fulfilment_return'.
-- This section MUST execute before the RPCs below, or the first stock_ledger
-- INSERT in pack_fulfilment_order will fail with a CHECK violation.
--
-- holder_consistency note: 'fulfilment_out' and 'fulfilment_return' are absent
-- from the holder_consistency constrained set ('issue_to_holding',
-- 'return_to_branch', 'sale', 'usage'). The existing CHECK therefore already
-- enforces holder_user_id IS NULL for these two reasons — no change needed to
-- holder_consistency.

alter table public.stock_ledger
  drop constraint stock_ledger_reason_check;

alter table public.stock_ledger
  add constraint stock_ledger_reason_check
  check (reason in (
    'vendor_invoice', 'sale', 'usage',
    'transfer_in', 'transfer_out', 'request_fulfilment',
    'adjustment', 'reversal',
    'issue_to_holding', 'return_to_branch', 'return_receipt',
    'fulfilment_out', 'fulfilment_return'
  ));


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. pack_fulfilment_order — full pool drain (replaces Phase 1a stub)
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Transitions: pending → packed.
--
-- Per line, drains POOL stock through BOTH costing engines (Option A):
--
--   FIFO mode:
--     drain_fifo_layers(pool) → aggregate lot costs → cogs_allocations INSERT
--     product_cost_state decremented by pool_avg × qty (NOT the FIFO lot total)
--
--   WEIGHTED mode:
--     v_cogs = qty × pool_avg → cogs_allocations INSERT
--     drain_fifo_layers(pool) called; result DISCARDED (structural sync only)
--     product_cost_state decremented by pool_avg × qty
--
-- product_cost_state is ALWAYS decremented with pool_avg × qty.
-- Substituting FIFO v_cogs_cents would corrupt the weighted running total —
-- this is the same invariant enforced in record_sale (app_0040).
--
-- Callable by: owner / admin / inventory of the branch.
-- Returns: 'packed'

create or replace function public.pack_fulfilment_order(
  p_order_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id            uuid := auth.uid();
  v_order              public.fulfilment_orders%rowtype;
  v_line               public.fulfilment_lines%rowtype;
  v_org_costing_method text;
  -- Pool qty from product_stock (locked for update)
  v_pool_qty           integer;
  -- Pool cost state (weighted engine)
  v_pool_qty_state     integer;
  v_pool_avg           bigint;
  v_pool_total         bigint;
  -- COGS accumulators per line
  v_cogs_cents         bigint;
  v_cost_known         boolean;
  -- product_cost_state new values after decrement
  v_new_qty            integer;
  v_new_total          bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_order
    from public.fulfilment_orders
   where id = p_order_id and deleted_at is null;

  if v_order.id is null then
    raise exception 'order not found';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'only pending orders can be packed (current status: %)', v_order.status;
  end if;

  if v_order.branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to pack orders for this branch';
  end if;

  -- Read org costing method once (FIFO or WEIGHTED; default WEIGHTED if unset).
  select coalesce(costing_method, 'weighted') into v_org_costing_method
    from public.organisations
   where id = v_order.organisation_id;

  -- ── Per-line pool drain ──────────────────────────────────────────────────────
  for v_line in
    select * from public.fulfilment_lines
     where order_id = p_order_id
  loop

    -- ── Step 1: Lock pool product_stock (serialises concurrent packs/transfers) ─
    select coalesce(quantity, 0) into v_pool_qty
      from public.product_stock
     where branch_id  = v_order.branch_id
       and product_id = v_line.product_id
     for update;

    -- ── Step 2: Pool stock guard ──────────────────────────────────────────────
    if coalesce(v_pool_qty, 0) < v_line.quantity then
      raise exception
        'insufficient pool stock for product % (pool: %, needed: %)',
        v_line.product_id, coalesce(v_pool_qty, 0), v_line.quantity;
    end if;

    -- ── Step 3: stock_ledger — fulfilment_out from pool ───────────────────────
    -- holder_user_id omitted → default NULL (pool bucket).
    -- holder_consistency CHECK allows NULL for any reason not in its constrained
    -- set; 'fulfilment_out' is not in that set.
    insert into public.stock_ledger (
      organisation_id, branch_id, product_id,
      quantity_delta, reason,
      reference_type, reference_id, created_by
    ) values (
      v_order.organisation_id, v_order.branch_id, v_line.product_id,
      -v_line.quantity, 'fulfilment_out',
      'fulfilment_order', p_order_id, v_user_id
    );

    -- ── Step 4: Decrement product_stock (pool) ────────────────────────────────
    update public.product_stock
       set quantity   = quantity - v_line.quantity,
           updated_at = now()
     where branch_id  = v_order.branch_id
       and product_id = v_line.product_id;

    -- ── Step 5: Lock pool product_cost_state ──────────────────────────────────
    select quantity, avg_cost_cents, total_cost_cents
      into v_pool_qty_state, v_pool_avg, v_pool_total
      from public.product_cost_state
     where branch_id      = v_order.branch_id
       and product_id     = v_line.product_id
       and holder_user_id is null
     for update;

    v_pool_qty_state := coalesce(v_pool_qty_state, 0);

    -- ── Step 6: COGS computation ──────────────────────────────────────────────
    if v_org_costing_method = 'fifo' then
      -- FIFO: drain pool cost_layers; aggregate lot costs.
      -- drain_fifo_layers is SECURITY DEFINER + REVOKE from public; callable
      -- here because pack_fulfilment_order is also SECURITY DEFINER.
      select
        case when bool_and(d.unit_cost_cents is not null)
               then sum(d.qty_consumed::bigint * d.unit_cost_cents)
             else null end,
        coalesce(bool_and(d.unit_cost_cents is not null), false)
      into v_cogs_cents, v_cost_known
      from public.drain_fifo_layers(
        v_order.organisation_id, v_order.branch_id,
        null,                  -- pool bucket (holder_user_id = NULL)
        v_line.product_id,
        v_line.quantity
      ) d;

    else
      -- WEIGHTED: COGS = qty × pool average cost at pack time.
      if v_pool_avg is not null then
        v_cogs_cents := v_line.quantity::bigint * v_pool_avg;
        v_cost_known := true;
      else
        v_cogs_cents := null;
        v_cost_known := false;
      end if;
    end if;

    -- ── Step 7: Freeze COGS into cogs_allocations ─────────────────────────────
    insert into public.cogs_allocations (
      organisation_id, branch_id, product_id,
      reference_type, reference_id,
      quantity, cogs_cents, cost_known, method_used
    ) values (
      v_order.organisation_id, v_order.branch_id, v_line.product_id,
      'fulfilment_line', v_line.id,
      v_line.quantity, v_cogs_cents, v_cost_known,
      v_org_costing_method
    );

    -- ── Step 8: Decrement pool product_cost_state (weighted engine) ───────────
    -- Always pool_avg × qty regardless of costing_method (record_sale invariant):
    -- product_cost_state is the weighted engine's running total; using FIFO
    -- v_cogs_cents here would corrupt the weighted average.
    v_new_qty   := greatest(v_pool_qty_state - v_line.quantity, 0);
    v_new_total := case
                     when v_new_qty = 0     then 0
                     when v_pool_avg is null then null
                     else greatest(
                           coalesce(v_pool_total, 0) - (v_line.quantity::bigint * v_pool_avg),
                           0
                         )
                   end;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      v_order.organisation_id, v_order.branch_id, null, v_line.product_id,
      v_new_qty,
      case when v_new_qty = 0 then null else v_pool_avg end,
      v_new_total
    )
    on conflict (branch_id, product_id) where holder_user_id is null
    do update set
      quantity         = excluded.quantity,
      avg_cost_cents   = excluded.avg_cost_cents,
      total_cost_cents = excluded.total_cost_cents,
      updated_at       = now();

    -- WEIGHTED mode: drain cost_layers in lockstep (structural sync, result discarded).
    -- Mirrors record_sale's PERFORM drain_fifo_layers at end of weighted path.
    if v_org_costing_method <> 'fifo' then
      perform public.drain_fifo_layers(
        v_order.organisation_id, v_order.branch_id,
        null,              -- pool bucket
        v_line.product_id,
        v_line.quantity
      );
    end if;
    -- FIFO mode: cost_layers drained in step 6; no second call needed.

  end loop;

  -- ── Transition status ────────────────────────────────────────────────────────
  update public.fulfilment_orders
     set status    = 'packed',
         packed_by = v_user_id,
         packed_at = now()
   where id = p_order_id;

  return 'packed';
end;
$$;

revoke all    on function public.pack_fulfilment_order(uuid) from public;
grant execute on function public.pack_fulfilment_order(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 3. cancel_fulfilment_order — pending + packed (replaces Phase 1a pending-only)
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Cancels a pending or packed order.
-- Shipped / delivered orders cannot be cancelled (stock is gone / deal complete).
--
-- Pending cancel: status update only — no stock was moved.
--
-- Packed cancel: reverses the pool drain written by pack_fulfilment_order:
--   Per line:
--     1. stock_ledger 'fulfilment_return' (+qty, holder_user_id = NULL)
--     2. product_stock += qty  (pool restore)
--     3. product_cost_state (pool) blended back at v_cogs_cents from
--        cogs_allocations — same weighted-avg formula as return_to_branch
--     4. fifo_add_layer(pool, qty, v_unit_cost, original_seq=NULL)
--        original_seq = NULL → new seq assigned (restored units enter at the
--        END of the pool FIFO queue). This is a known trade-off: preserving
--        exact lot positions would require a fulfilment_cost_layers snapshot
--        table (deferred; acceptable for a rare pack-cancel edge case).
--
-- Callable by:
--   • The order requester (own pending order)
--   • owner / admin / inventory of the branch (pending or packed)
--
-- Returns: 'cancelled'

create or replace function public.cancel_fulfilment_order(
  p_order_id uuid,
  p_note     text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid := auth.uid();
  v_order          public.fulfilment_orders%rowtype;
  v_line           public.fulfilment_lines%rowtype;
  -- Frozen COGS from cogs_allocations (written by pack_fulfilment_order)
  v_cogs_cents     bigint;
  v_unit_cost      bigint;
  -- Pool cost state (for blend-back)
  v_pool_qty_state integer;
  v_pool_avg       bigint;
  v_pool_total     bigint;
  v_new_qty        integer;
  v_new_total      bigint;
  v_new_avg        bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_order
    from public.fulfilment_orders
   where id = p_order_id and deleted_at is null;

  if v_order.id is null then
    raise exception 'order not found';
  end if;

  -- Shipped / delivered are terminal — cannot cancel.
  if v_order.status in ('shipped', 'delivered') then
    raise exception 'cannot cancel a % order', v_order.status;
  end if;

  if v_order.status not in ('pending', 'packed') then
    raise exception 'cannot cancel order in status %', v_order.status;
  end if;

  -- Requester can cancel their own; managers can cancel any in their branch.
  if v_order.requested_by <> v_user_id
     and v_order.branch_id not in (select public.user_vendor_write_branch_ids())
  then
    raise exception 'not authorised to cancel this order';
  end if;

  if v_order.status = 'packed' then
    -- ── Reverse the pool drain performed by pack_fulfilment_order ──────────────
    for v_line in
      select * from public.fulfilment_lines
       where order_id = p_order_id
    loop
      -- Read COGS frozen at pack time.
      select cogs_cents into v_cogs_cents
        from public.cogs_allocations
       where reference_type = 'fulfilment_line'
         and reference_id   = v_line.id
       limit 1;

      -- Per-unit cost for FIFO layer re-add (NULL propagates if COGS was unknown).
      v_unit_cost := case
                       when v_cogs_cents is not null and v_line.quantity > 0
                         then v_cogs_cents / v_line.quantity
                       else null
                     end;

      -- 1. Ledger: fulfilment_return (pool inflow, holder_user_id = NULL default).
      insert into public.stock_ledger (
        organisation_id, branch_id, product_id,
        quantity_delta, reason,
        reference_type, reference_id, created_by
      ) values (
        v_order.organisation_id, v_order.branch_id, v_line.product_id,
        v_line.quantity, 'fulfilment_return',
        'fulfilment_order', p_order_id, v_user_id
      );

      -- 2. Restore product_stock (pool).
      insert into public.product_stock (
        organisation_id, branch_id, product_id, quantity
      ) values (
        v_order.organisation_id, v_order.branch_id, v_line.product_id, v_line.quantity
      )
      on conflict (branch_id, product_id)
      do update set
        quantity   = product_stock.quantity + excluded.quantity,
        updated_at = now();

      -- 3. Blend returned cost back into pool product_cost_state.
      -- Lock the pool row to prevent concurrent mutations (matches pack drain step 5).
      select quantity, avg_cost_cents, total_cost_cents
        into v_pool_qty_state, v_pool_avg, v_pool_total
        from public.product_cost_state
       where branch_id      = v_order.branch_id
         and product_id     = v_line.product_id
         and holder_user_id is null
       for update;

      v_pool_qty_state := coalesce(v_pool_qty_state, 0);
      v_new_qty        := v_pool_qty_state + v_line.quantity;

      if v_cogs_cents is null then
        -- Unknown cost: taint the pool (mirrors return_to_branch unknown-cost path).
        v_new_total := null;
        v_new_avg   := null;
      elsif v_pool_qty_state > 0 and v_pool_avg is null then
        -- Pool already tainted; cannot blend known cost into unknown pool.
        v_new_total := null;
        v_new_avg   := null;
      else
        -- Weighted blend: (existing total + returned cost) / new qty.
        v_new_total := coalesce(v_pool_total, 0) + v_cogs_cents;
        v_new_avg   := v_new_total / v_new_qty;
      end if;

      insert into public.product_cost_state (
        organisation_id, branch_id, holder_user_id, product_id,
        quantity, avg_cost_cents, total_cost_cents
      ) values (
        v_order.organisation_id, v_order.branch_id, null, v_line.product_id,
        v_new_qty, v_new_avg, v_new_total
      )
      on conflict (branch_id, product_id) where holder_user_id is null
      do update set
        quantity         = excluded.quantity,
        avg_cost_cents   = excluded.avg_cost_cents,
        total_cost_cents = excluded.total_cost_cents,
        updated_at       = now();

      -- 4. Restore FIFO cost_layers for the pool.
      -- original_seq = NULL → assigns new seq (see trade-off in function header).
      perform public.fifo_add_layer(
        v_order.organisation_id,
        v_order.branch_id,
        null,              -- pool bucket
        v_line.product_id,
        v_line.quantity,
        v_unit_cost,       -- per-unit cost from cogs_allocations (or NULL)
        null,              -- new seq; not a cross-bucket move
        'fulfilment_return',
        p_order_id
      );

    end loop;
  end if;
  -- Pending cancel: no stock was moved; fall through to status update.

  update public.fulfilment_orders
     set status       = 'cancelled',
         cancelled_by = v_user_id,
         cancelled_at = now(),
         note         = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
   where id = p_order_id;

  return 'cancelled';
end;
$$;

revoke all    on function public.cancel_fulfilment_order(uuid, text) from public;
grant execute on function public.cancel_fulfilment_order(uuid, text) to authenticated;
