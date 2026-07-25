-- ─────────────────────────────────────────────────────────────────────────────
-- app_0035_costing_outflows.sql
--
-- Extends outflow RPCs to freeze COGS into cogs_allocations and decrement
-- the seller/practitioner's holding cost bucket.
-- return_to_branch moves cost holding→pool (NO COGS — location change only).
--
-- Changes:
--   1. record_sale:          freeze COGS per sale_line; decrement holder bucket.
--   2. record_service_usage: freeze COGS per service_consumption; decrement holder.
--   3. return_to_branch:     move cost holder→pool; no cogs_allocations row.
--
-- All existing logic in every function is byte-identical.
-- Lock ordering: staff_holdings FOR UPDATE (existing) always precedes
-- product_cost_state FOR UPDATE (new) — consistent with inflow RPCs where
-- product_stock precedes product_cost_state.
--
-- NULL / unknown semantics:
--   holder_avg IS NULL → cost unknown → cogs_cents NULL, cost_known false.
--   NEVER store 0 as cogs_cents to represent unknown cost.
--   Removing units at avg does NOT change avg — only qty and total drop.
--   If qty → 0: reset avg→NULL, total→0.
--
-- method_used:
--   Always 'weighted' right now (FIFO engine not built).
--   v_org_costing_method is read and preserved so the future FIFO branch
--   has the variable in scope. When FIFO ships, the marked comment block
--   branches to the FIFO allocation path and records method_used='fifo'.
--
-- Depends on: app_0024_sales, app_0025_sale_payment_method,
--             app_0026_service_usage, app_0027_return_to_branch,
--             app_0031_sales_payment (current record_sale body),
--             app_0033_costing_schema (product_cost_state, cogs_allocations)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. record_sale — freeze COGS per sale line + decrement holder cost bucket
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.record_sale(
  p_branch_id      uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_sold_on        date,
  p_note           text,
  p_payment_method text,
  p_payment_status text,
  p_lines          jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_org_id     uuid;
  v_sale_id    uuid;
  v_line       jsonb;
  v_product_id uuid;
  v_qty        integer;
  v_price      bigint;
  v_held       integer;
  v_total      bigint := 0;
  -- ── NEW: costing accumulators ─────────────────────────────────────────────
  v_org_costing_method text;
  v_sale_line_id       uuid;
  v_holder_qty         integer;
  v_holder_avg         bigint;
  v_holder_total       bigint;
  v_cogs_cents         bigint;
  v_cost_known         boolean;
  v_new_qty            integer;
  v_new_total          bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select organisation_id into v_org_id
    from public.branches
   where id = p_branch_id
     and deleted_at is null;

  if v_org_id is null then
    raise exception 'branch not found';
  end if;

  if p_branch_id not in (select public.user_vendor_read_branch_ids()) then
    raise exception 'not authorised to record sales in this branch';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale must have at least one line';
  end if;

  if p_payment_method is not null and
     p_payment_method not in ('cash', 'pos', 'bank_transfer', 'cheque', 'other') then
    raise exception 'invalid payment method';
  end if;

  if p_payment_status is null or p_payment_status not in ('paid', 'unpaid') then
    raise exception 'payment_status must be paid or unpaid';
  end if;

  -- ── NEW: read org costing preference before the loop ─────────────────────────
  -- v_org_costing_method is in scope for the FIFO branch when it ships.
  -- Currently unused in the computation — weighted-average is always applied.
  select coalesce(costing_method, 'weighted') into v_org_costing_method
    from public.organisations
   where id = v_org_id;

  insert into public.sales (
    organisation_id, branch_id, seller_user_id,
    customer_name, customer_phone, sold_on, total_cents, note,
    payment_method, payment_status, amount_paid_cents, created_by
  ) values (
    v_org_id, p_branch_id, v_user_id,
    nullif(trim(p_customer_name),  ''),
    nullif(trim(p_customer_phone), ''),
    coalesce(p_sold_on, current_date),
    0,
    nullif(trim(p_note), ''),
    p_payment_method, p_payment_status, 0, v_user_id
  )
  returning id into v_sale_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty        := (v_line->>'quantity')::integer;
    v_price      := (v_line->>'unit_price_cents')::bigint;

    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be greater than 0';
    end if;

    if v_price is null or v_price < 0 then
      raise exception 'unit price must be 0 or greater';
    end if;

    if not exists (
      select 1
        from public.products
       where id              = v_product_id
         and organisation_id = v_org_id
         and deleted_at      is null
    ) then
      raise exception 'product % not found in this organisation', v_product_id;
    end if;

    -- FOR UPDATE locks (branch, holder, product). Cost-state lock follows below.
    select coalesce(quantity, 0) into v_held
      from public.staff_holdings
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id
     for update;

    if coalesce(v_held, 0) < v_qty then
      raise exception
        'insufficient holding for product % (holding: %, selling: %)',
        v_product_id, coalesce(v_held, 0), v_qty;
    end if;

    -- ── NEW: capture sale_line.id (needed as cogs_allocations reference_id) ──
    insert into public.sale_lines (
      sale_id, product_id, quantity, unit_price_cents, line_total_cents
    ) values (
      v_sale_id, v_product_id, v_qty, v_price, v_qty * v_price
    )
    returning id into v_sale_line_id;

    v_total := v_total + (v_qty * v_price);

    insert into public.stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, holder_user_id, created_by
    ) values (
      v_org_id, p_branch_id, v_product_id, -v_qty,
      'sale', 'sale', v_sale_id, v_user_id, v_user_id
    );

    update public.staff_holdings
       set quantity   = quantity - v_qty,
           updated_at = now()
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id;

    -- ── NEW: freeze COGS + decrement holder cost bucket ───────────────────────
    -- staff_holdings already locked above; cost-state lock follows (consistent order).
    select quantity, avg_cost_cents, total_cost_cents
      into v_holder_qty, v_holder_avg, v_holder_total
      from public.product_cost_state
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id
     for update;

    v_holder_qty := coalesce(v_holder_qty, 0);

    -- Frozen COGS: qty × holder_avg at this exact moment.
    -- NULL avg = unknown cost → cogs NULL, cost_known false. Never 0.
    if v_holder_avg is not null then
      v_cogs_cents := v_qty * v_holder_avg;
      v_cost_known := true;
    else
      v_cogs_cents := null;
      v_cost_known := false;
    end if;

    -- TODO(FIFO 1c-iv): when FIFO ships, branch here:
    --   if v_org_costing_method = 'fifo' then allocate from oldest lots,
    --   compute v_cogs_cents from FIFO queue, set method_used='fifo'.
    --   For now: weighted-average is the only implemented method.
    insert into public.cogs_allocations (
      organisation_id, branch_id, product_id,
      reference_type, reference_id,
      quantity, cogs_cents, cost_known, method_used
    ) values (
      v_org_id, p_branch_id, v_product_id,
      'sale_line', v_sale_line_id,
      v_qty, v_cogs_cents, v_cost_known,
      'weighted'   -- honest: weighted-average math was used regardless of org preference
    );

    -- Decrement holder cost bucket.
    -- Removing units at avg does NOT change avg — only qty and total drop.
    -- qty → 0: reset avg→NULL, total→0.
    v_new_qty   := greatest(v_holder_qty - v_qty, 0);
    v_new_total := case
                     when v_new_qty = 0        then 0
                     when v_holder_avg is null  then null
                     else coalesce(v_holder_total, 0) - v_cogs_cents
                   end;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      v_org_id, p_branch_id, v_user_id, v_product_id,
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
    -- ── END NEW ──────────────────────────────────────────────────────────────

  end loop;

  update public.sales
     set total_cents       = v_total,
         amount_paid_cents = case
                               when p_payment_status = 'paid' then v_total
                               else 0
                             end
   where id = v_sale_id;

  return v_sale_id;
end;
$$;

revoke all    on function public.record_sale(uuid, text, text, date, text, text, text, jsonb) from public;
grant execute on function public.record_sale(uuid, text, text, date, text, text, text, jsonb) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. record_service_usage — freeze COGS per consumption + decrement holder
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.record_service_usage(
  p_branch_id         uuid,
  p_service_type_id   uuid,
  p_customer_name     text,
  p_customer_phone    text,
  p_performed_on      date,
  p_service_fee_cents bigint,
  p_note              text,
  p_lines             jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_org_id     uuid;
  v_record_id  uuid;
  v_line       jsonb;
  v_product_id uuid;
  v_qty        integer;
  v_held       integer;
  -- ── NEW: costing accumulators ─────────────────────────────────────────────
  v_org_costing_method text;
  v_consumption_id     uuid;
  v_holder_qty         integer;
  v_holder_avg         bigint;
  v_holder_total       bigint;
  v_cogs_cents         bigint;
  v_cost_known         boolean;
  v_new_qty            integer;
  v_new_total          bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select organisation_id into v_org_id
    from public.branches
   where id = p_branch_id
     and deleted_at is null;

  if v_org_id is null then
    raise exception 'branch not found';
  end if;

  if p_branch_id not in (select public.user_vendor_read_branch_ids()) then
    raise exception 'not authorised to record service usage in this branch';
  end if;

  if not exists (
    select 1
      from public.service_types
     where id              = p_service_type_id
       and organisation_id = v_org_id
       and is_active       = true
       and deleted_at      is null
  ) then
    raise exception 'service type not found or inactive';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'service usage must consume at least one product';
  end if;

  if p_service_fee_cents is not null and p_service_fee_cents < 0 then
    raise exception 'service fee cannot be negative';
  end if;

  -- ── NEW: read org costing preference before the loop ─────────────────────────
  select coalesce(costing_method, 'weighted') into v_org_costing_method
    from public.organisations
   where id = v_org_id;

  insert into public.service_records (
    organisation_id, branch_id, service_type_id, performed_by,
    customer_name, customer_phone, performed_on,
    service_fee_cents, note, created_by
  ) values (
    v_org_id, p_branch_id, p_service_type_id, v_user_id,
    nullif(trim(p_customer_name),  ''),
    nullif(trim(p_customer_phone), ''),
    coalesce(p_performed_on, current_date),
    p_service_fee_cents,
    nullif(trim(p_note), ''),
    v_user_id
  )
  returning id into v_record_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty        := (v_line->>'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be greater than 0';
    end if;

    if not exists (
      select 1
        from public.products
       where id              = v_product_id
         and organisation_id = v_org_id
         and deleted_at      is null
    ) then
      raise exception 'product % not found in this organisation', v_product_id;
    end if;

    -- FOR UPDATE locks (branch, holder, product). Cost-state lock follows below.
    select coalesce(quantity, 0) into v_held
      from public.staff_holdings
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id
     for update;

    if coalesce(v_held, 0) < v_qty then
      raise exception
        'insufficient holding for product % (holding: %, consuming: %)',
        v_product_id, coalesce(v_held, 0), v_qty;
    end if;

    -- ── NEW: capture service_consumption.id (needed as cogs_allocations reference_id) ──
    insert into public.service_consumption (
      service_record_id, product_id, quantity
    ) values (
      v_record_id, v_product_id, v_qty
    )
    returning id into v_consumption_id;

    insert into public.stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, holder_user_id, created_by
    ) values (
      v_org_id, p_branch_id, v_product_id, -v_qty,
      'usage', 'service_record', v_record_id, v_user_id, v_user_id
    );

    update public.staff_holdings
       set quantity   = quantity - v_qty,
           updated_at = now()
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id;

    -- ── NEW: freeze COGS + decrement holder cost bucket ───────────────────────
    select quantity, avg_cost_cents, total_cost_cents
      into v_holder_qty, v_holder_avg, v_holder_total
      from public.product_cost_state
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id
     for update;

    v_holder_qty := coalesce(v_holder_qty, 0);

    if v_holder_avg is not null then
      v_cogs_cents := v_qty * v_holder_avg;
      v_cost_known := true;
    else
      v_cogs_cents := null;
      v_cost_known := false;
    end if;

    -- TODO(FIFO 1c-iv): when FIFO ships, branch here on v_org_costing_method.
    insert into public.cogs_allocations (
      organisation_id, branch_id, product_id,
      reference_type, reference_id,
      quantity, cogs_cents, cost_known, method_used
    ) values (
      v_org_id, p_branch_id, v_product_id,
      'service_consumption', v_consumption_id,
      v_qty, v_cogs_cents, v_cost_known,
      'weighted'
    );

    v_new_qty   := greatest(v_holder_qty - v_qty, 0);
    v_new_total := case
                     when v_new_qty = 0        then 0
                     when v_holder_avg is null  then null
                     else coalesce(v_holder_total, 0) - v_cogs_cents
                   end;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      v_org_id, p_branch_id, v_user_id, v_product_id,
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
    -- ── END NEW ──────────────────────────────────────────────────────────────

  end loop;

  return v_record_id;
end;
$$;

revoke all    on function public.record_service_usage(uuid, uuid, text, text, date, bigint, text, jsonb) from public;
grant execute on function public.record_service_usage(uuid, uuid, text, text, date, bigint, text, jsonb) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 3. return_to_branch — move cost holder → pool (NO COGS)
-- ╚══════════════════════════════════════════════════════════════════════════════

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
  -- ── NEW: cost-state accumulators ─────────────────────────────────────────
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

  -- FOR UPDATE locks (branch, holder, product). Holder cost-state lock follows.
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

  -- ── NEW: read and lock holder cost bucket ─────────────────────────────────
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
  -- ── END NEW (holder read) ─────────────────────────────────────────────────

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

  -- ── NEW: decrement holder cost bucket ─────────────────────────────────────
  -- No cogs_allocations row — this is a location change, not a consumption.
  -- Removing units at avg does NOT change avg; qty → 0 resets to NULL/0.
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
  -- ── END NEW (holder decrement) ────────────────────────────────────────────

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

  -- ── NEW: increment branch-pool cost bucket at holder avg ──────────────────
  -- product_stock upsert above implicitly locks that row; pool cost-state follows.
  -- Weighted-average the returning units into the pool at their carried cost.
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
  -- ── END NEW (pool increment) ──────────────────────────────────────────────

end;
$$;

revoke all    on function public.return_to_branch(uuid, uuid, integer, text) from public;
grant execute on function public.return_to_branch(uuid, uuid, integer, text) to authenticated;
