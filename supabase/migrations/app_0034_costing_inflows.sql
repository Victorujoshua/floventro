-- ─────────────────────────────────────────────────────────────────────────────
-- app_0034_costing_inflows.sql
--
-- Extends inflow/movement RPCs to maintain product_cost_state (weighted-average).
-- COGS write (outflow) comes in 1c-iii. This step: cost ENTERS and MOVES only.
--
-- Changes:
--   1. stock_transfer_lines: add cost_at_send_cents (unit cost locked at initiate).
--   2. receive_invoice_stock: upsert branch-pool cost bucket on each batch received.
--   3. review_stock_request: move cost pool → holder bucket on each approval.
--   4. initiate_transfer: stamp cost_at_send + decrement source pool.
--   5. receive_transfer: weighted-average into dest pool at cost_at_send_cents.
--   6. cancel_transfer: credit units back to source pool at cost_at_send_cents.
--
-- All existing logic in every function is byte-identical.
-- Lock ordering: product_stock FOR UPDATE always precedes product_cost_state
-- FOR UPDATE — consistent across all RPCs to prevent deadlocks.
--
-- NULL semantics (enforced everywhere):
--   avg_cost_cents NULL  = cost unknown (never 0; 0 would imply free goods).
--   Removing units at avg does NOT change avg — only qty and total drop.
--   If qty reaches 0, reset avg→NULL, total→0.
--   Unknown propagates: if any input is NULL, output avg/total is NULL.
--   Tainted bucket (qty > 0 AND avg NULL): a known-cost arrival cannot honestly
--     blend with unknown-cost units — avg stays NULL, qty still grows.
--
-- Depends on: app_0028_transfers (stock_transfer_lines)
--             app_0029_invoice_receipt_split (receive_invoice_stock)
--             app_0023_extend_review_request (review_stock_request)
--             app_0033_costing_schema (product_cost_state)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. stock_transfer_lines: add cost_at_send_cents
-- ╚══════════════════════════════════════════════════════════════════════════════
-- Stamped at initiate_transfer = source pool avg_cost_cents at send time.
-- NULL if the source bucket had unknown cost. Read at receive_transfer and
-- cancel_transfer to credit units at the cost they actually carried in transit.

alter table public.stock_transfer_lines
  add column cost_at_send_cents bigint;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. receive_invoice_stock — cost ENTERS branch pool
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.receive_invoice_stock(
  p_invoice_id uuid,
  p_lines      jsonb,
  p_note       text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_inv          vendor_invoices%rowtype;
  v_line         jsonb;
  v_line_id      uuid;
  v_batch        integer;
  v_il           vendor_invoice_lines%rowtype;
  v_all_full     boolean := true;
  v_any_received boolean := false;
  -- ── NEW: cost-state accumulators ─────────────────────────────────────────
  v_pool_qty     integer;
  v_pool_avg     bigint;
  v_pool_total   bigint;
  v_new_qty      integer;
  v_new_total    bigint;
  v_new_avg      bigint;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;

  select * into v_inv from vendor_invoices where id = p_invoice_id and deleted_at is null;
  if v_inv.id is null then raise exception 'invoice not found'; end if;
  if v_inv.receipt_status = 'received' then raise exception 'invoice is already fully received'; end if;

  if v_inv.branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to receive stock for this invoice';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no received lines provided';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id := (v_line->>'line_id')::uuid;
    v_batch   := (v_line->>'quantity_received')::integer;

    select * into v_il from vendor_invoice_lines where id = v_line_id and invoice_id = p_invoice_id;
    if v_il.id is null then raise exception 'line % not part of this invoice', v_line_id; end if;

    if v_batch is null or v_batch <= 0 then raise exception 'received quantity must be greater than 0'; end if;

    if coalesce(v_il.quantity_received, 0) + v_batch > v_il.quantity then
      raise exception 'cannot receive more than ordered for a line (ordered %, already %, receiving %)',
        v_il.quantity, coalesce(v_il.quantity_received, 0), v_batch;
    end if;

    -- Lock the stock row (all cost-state locks follow this, preserving lock order).
    perform 1 from product_stock
      where branch_id = v_inv.branch_id and product_id = v_il.product_id for update;

    insert into stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, unit_cost_cents, created_by
    ) values (
      v_inv.organisation_id, v_inv.branch_id, v_il.product_id, v_batch,
      'vendor_invoice', 'vendor_invoice', p_invoice_id, v_il.unit_cost_cents, v_user_id
    );

    insert into product_stock (organisation_id, branch_id, product_id, quantity)
    values (v_inv.organisation_id, v_inv.branch_id, v_il.product_id, v_batch)
    on conflict (branch_id, product_id)
    do update set
      quantity   = product_stock.quantity + excluded.quantity,
      updated_at = now();

    update vendor_invoice_lines
       set quantity_received = coalesce(quantity_received, 0) + v_batch
     where id = v_line_id;

    -- ── NEW: weighted-average cost into branch pool ───────────────────────────
    -- in_cost = v_il.unit_cost_cents (always non-null — validated at invoice creation).
    select quantity, avg_cost_cents, total_cost_cents
      into v_pool_qty, v_pool_avg, v_pool_total
      from public.product_cost_state
     where branch_id      = v_inv.branch_id
       and product_id     = v_il.product_id
       and holder_user_id is null
     for update;

    v_pool_qty := coalesce(v_pool_qty, 0);
    v_new_qty  := v_pool_qty + v_batch;

    if v_pool_qty > 0 and v_pool_avg is null then
      -- Tainted bucket: existing units have unknown cost. Cannot honestly blend
      -- known-cost arrivals with them. avg stays NULL; qty still grows.
      v_new_total := null;
      v_new_avg   := null;
    else
      -- Normal weighted-average.
      v_new_total := coalesce(v_pool_total, 0) + (v_batch * v_il.unit_cost_cents);
      v_new_avg   := v_new_total / v_new_qty;
    end if;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      v_inv.organisation_id, v_inv.branch_id, null, v_il.product_id,
      v_new_qty, v_new_avg, v_new_total
    )
    on conflict (branch_id, product_id) where holder_user_id is null
    do update set
      quantity         = excluded.quantity,
      avg_cost_cents   = excluded.avg_cost_cents,
      total_cost_cents = excluded.total_cost_cents,
      updated_at       = now();
    -- ── END NEW ──────────────────────────────────────────────────────────────

  end loop;

  select bool_and(coalesce(quantity_received, 0) >= quantity),
         bool_or(coalesce(quantity_received, 0) > 0)
    into v_all_full, v_any_received
    from vendor_invoice_lines where invoice_id = p_invoice_id;

  update vendor_invoices
     set receipt_status = case
                            when v_all_full     then 'received'
                            when v_any_received then 'partially_received'
                            else 'pending'
                          end,
         note       = coalesce(nullif(trim(p_note), ''), note),
         updated_at = now()
   where id = p_invoice_id;

  return (select receipt_status from vendor_invoices where id = p_invoice_id);
end;
$$;

revoke all    on function public.receive_invoice_stock(uuid, jsonb, text) from public;
grant execute on function public.receive_invoice_stock(uuid, jsonb, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 3. review_stock_request — cost MOVES pool → holder
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.review_stock_request(
  p_request_id  uuid,
  p_decision    text,
  p_lines       jsonb,
  p_review_note text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id       uuid    := auth.uid();
  v_req           stock_requests%rowtype;
  v_line          jsonb;
  v_line_id       uuid;
  v_qty_approved  integer;
  v_req_line      stock_request_lines%rowtype;
  v_available     integer;
  v_any_approved  boolean := false;
  v_any_reduced   boolean := false;
  v_final_status  text;
  -- ── NEW: cost-state accumulators ─────────────────────────────────────────
  v_pool_qty      integer;
  v_pool_avg      bigint;
  v_pool_total    bigint;
  v_holder_qty    integer;
  v_holder_avg    bigint;
  v_holder_total  bigint;
  v_move_cost     bigint;
  v_new_qty       integer;
  v_new_total     bigint;
  v_new_avg       bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_req
    from public.stock_requests
   where id = p_request_id
     and deleted_at is null;

  if v_req.id is null then
    raise exception 'request not found';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'request already reviewed';
  end if;

  if v_req.branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to review requests in this branch';
  end if;

  if p_decision = 'reject' then
    update public.stock_request_lines
       set quantity_approved = 0
     where request_id = p_request_id;

    update public.stock_requests
       set status      = 'rejected',
           reviewed_by = v_user_id,
           reviewed_at = now(),
           review_note = nullif(p_review_note, '')
     where id = p_request_id;

    return 'rejected';
  end if;

  if p_decision <> 'approve' then
    raise exception 'invalid decision: must be ''approve'' or ''reject''';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no lines provided for approval';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id      := (v_line->>'line_id')::uuid;
    v_qty_approved := (v_line->>'quantity_approved')::integer;

    select * into v_req_line
      from public.stock_request_lines
     where id = v_line_id
       and request_id = p_request_id;

    if v_req_line.id is null then
      raise exception 'line % is not part of this request', v_line_id;
    end if;

    if v_qty_approved is null or v_qty_approved < 0 then
      raise exception 'approved quantity for line % must be >= 0', v_line_id;
    end if;

    if v_qty_approved > v_req_line.quantity_requested then
      raise exception 'cannot approve more than requested for line % (requested %, got %)',
        v_line_id, v_req_line.quantity_requested, v_qty_approved;
    end if;

    update public.stock_request_lines
       set quantity_approved = v_qty_approved
     where id = v_line_id;

    if v_qty_approved < v_req_line.quantity_requested then
      v_any_reduced := true;
    end if;

    if v_qty_approved = 0 then
      continue;
    end if;

    v_any_approved := true;

    -- FOR UPDATE on product_stock — all cost-state locks follow this.
    select coalesce(quantity, 0) into v_available
      from public.product_stock
     where branch_id  = v_req.branch_id
       and product_id = v_req_line.product_id
     for update;

    if coalesce(v_available, 0) < v_qty_approved then
      raise exception
        'insufficient stock for product % in branch % (on hand: %, requested: %)',
        v_req_line.product_id, v_req.branch_id,
        coalesce(v_available, 0), v_qty_approved;
    end if;

    insert into public.stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, created_by
    ) values (
      v_req.organisation_id, v_req.branch_id, v_req_line.product_id, -v_qty_approved,
      'request_fulfilment', 'stock_request', p_request_id, v_user_id
    );

    update public.product_stock
       set quantity   = quantity - v_qty_approved,
           updated_at = now()
     where branch_id  = v_req.branch_id
       and product_id = v_req_line.product_id;

    insert into public.stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, holder_user_id, created_by
    ) values (
      v_req.organisation_id, v_req.branch_id, v_req_line.product_id, v_qty_approved,
      'issue_to_holding', 'stock_request', p_request_id, v_req.requested_by, v_user_id
    );

    insert into public.staff_holdings (
      organisation_id, branch_id, holder_user_id, product_id, quantity
    ) values (
      v_req.organisation_id, v_req.branch_id, v_req.requested_by, v_req_line.product_id, v_qty_approved
    )
    on conflict (branch_id, holder_user_id, product_id)
    do update
      set quantity   = staff_holdings.quantity + excluded.quantity,
          updated_at = now();

    -- ── NEW: cost state — move cost pool → holder ─────────────────────────────
    -- Step 1: lock and read source pool bucket.
    select quantity, avg_cost_cents, total_cost_cents
      into v_pool_qty, v_pool_avg, v_pool_total
      from public.product_cost_state
     where branch_id      = v_req.branch_id
       and product_id     = v_req_line.product_id
       and holder_user_id is null
     for update;

    v_pool_qty  := coalesce(v_pool_qty, 0);

    -- Issued units carry pool avg. NULL avg → unknown, propagates to holder.
    v_move_cost := case
                     when v_pool_avg is not null then v_qty_approved * v_pool_avg
                     else null
                   end;

    -- Step 2: decrement pool. Removing units at avg does not change avg.
    --         If qty hits 0: avg→NULL, total→0.
    v_new_qty   := greatest(v_pool_qty - v_qty_approved, 0);
    v_new_total := case
                     when v_new_qty = 0      then 0
                     when v_pool_avg is null  then null
                     else coalesce(v_pool_total, 0) - v_move_cost
                   end;
    v_new_avg   := case when v_new_qty = 0 then null else v_pool_avg end;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      v_req.organisation_id, v_req.branch_id, null, v_req_line.product_id,
      v_new_qty, v_new_avg, v_new_total
    )
    on conflict (branch_id, product_id) where holder_user_id is null
    do update set
      quantity         = excluded.quantity,
      avg_cost_cents   = excluded.avg_cost_cents,
      total_cost_cents = excluded.total_cost_cents,
      updated_at       = now();

    -- Step 3: increment holder bucket. Weighted-average in moved units at pool avg.
    --         Unknown propagates if either side has NULL avg.
    select quantity, avg_cost_cents, total_cost_cents
      into v_holder_qty, v_holder_avg, v_holder_total
      from public.product_cost_state
     where branch_id      = v_req.branch_id
       and holder_user_id = v_req.requested_by
       and product_id     = v_req_line.product_id
     for update;

    v_holder_qty := coalesce(v_holder_qty, 0);
    v_new_qty    := v_holder_qty + v_qty_approved;

    if v_move_cost is null then
      -- Pool cost unknown; propagate to holder.
      v_new_total := null;
      v_new_avg   := null;
    elsif v_holder_qty > 0 and v_holder_avg is null then
      -- Holder already has tainted units; cannot honestly blend with known cost.
      v_new_total := null;
      v_new_avg   := null;
    else
      v_new_total := coalesce(v_holder_total, 0) + v_move_cost;
      v_new_avg   := v_new_total / v_new_qty;
    end if;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      v_req.organisation_id, v_req.branch_id, v_req.requested_by, v_req_line.product_id,
      v_new_qty, v_new_avg, v_new_total
    )
    on conflict (branch_id, holder_user_id, product_id) where holder_user_id is not null
    do update set
      quantity         = excluded.quantity,
      avg_cost_cents   = excluded.avg_cost_cents,
      total_cost_cents = excluded.total_cost_cents,
      updated_at       = now();
    -- ── END NEW ──────────────────────────────────────────────────────────────

  end loop;

  if not v_any_approved then
    v_final_status := 'rejected';
  elsif v_any_reduced then
    v_final_status := 'partially_approved';
  else
    v_final_status := 'approved';
  end if;

  update public.stock_requests
     set status      = v_final_status,
         reviewed_by = v_user_id,
         reviewed_at = now(),
         review_note = nullif(p_review_note, '')
   where id = p_request_id;

  return v_final_status;
end;
$$;

revoke all    on function public.review_stock_request(uuid, text, jsonb, text) from public;
grant execute on function public.review_stock_request(uuid, text, jsonb, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 4. initiate_transfer — stamp cost at send + decrement source pool
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.initiate_transfer(
  p_source_branch_id uuid,
  p_dest_branch_id   uuid,
  p_note             text,
  p_lines            jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_org_id       uuid;
  v_dest_org     uuid;
  v_transfer_id  uuid;
  v_line         jsonb;
  v_product_id   uuid;
  v_qty          integer;
  v_available    integer;
  -- ── NEW: cost-state accumulators + per-line id for precise stamp ──────────
  v_xfer_line_id uuid;
  v_pool_qty     integer;
  v_pool_avg     bigint;
  v_pool_total   bigint;
  v_new_qty      integer;
  v_new_total    bigint;
  v_new_avg      bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_source_branch_id = p_dest_branch_id then
    raise exception 'source and destination must differ';
  end if;

  select organisation_id into v_org_id
    from public.branches
   where id = p_source_branch_id and deleted_at is null;
  if v_org_id is null then
    raise exception 'source branch not found';
  end if;

  select organisation_id into v_dest_org
    from public.branches
   where id = p_dest_branch_id and deleted_at is null;
  if v_dest_org is null then
    raise exception 'destination branch not found';
  end if;

  if v_org_id <> v_dest_org then
    raise exception 'cannot transfer between different organisations';
  end if;

  if p_source_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to send stock from this branch';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a transfer must have at least one line';
  end if;

  insert into public.stock_transfers (
    organisation_id, source_branch_id, dest_branch_id, status, initiated_by, note
  ) values (
    v_org_id, p_source_branch_id, p_dest_branch_id, 'in_transit',
    v_user_id, nullif(trim(p_note), '')
  )
  returning id into v_transfer_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty        := (v_line->>'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be greater than 0';
    end if;

    if not exists (
      select 1 from public.products
       where id = v_product_id and organisation_id = v_org_id and deleted_at is null
    ) then
      raise exception 'product % not found in this organisation', v_product_id;
    end if;

    -- FOR UPDATE on product_stock — cost-state lock follows below.
    select coalesce(quantity, 0) into v_available
      from public.product_stock
     where branch_id  = p_source_branch_id
       and product_id = v_product_id
     for update;

    if coalesce(v_available, 0) < v_qty then
      raise exception
        'insufficient stock for product % at source branch (on hand: %, sending: %)',
        v_product_id, coalesce(v_available, 0), v_qty;
    end if;

    insert into public.stock_transfer_lines (transfer_id, product_id, quantity_sent)
    values (v_transfer_id, v_product_id, v_qty)
    returning id into v_xfer_line_id;

    insert into public.stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, created_by
    ) values (
      v_org_id, p_source_branch_id, v_product_id, -v_qty,
      'transfer_out', 'stock_transfer', v_transfer_id, v_user_id
    );

    update public.product_stock
       set quantity   = quantity - v_qty,
           updated_at = now()
     where branch_id  = p_source_branch_id
       and product_id = v_product_id;

    -- ── NEW: stamp cost at send + decrement source pool ───────────────────────
    select quantity, avg_cost_cents, total_cost_cents
      into v_pool_qty, v_pool_avg, v_pool_total
      from public.product_cost_state
     where branch_id      = p_source_branch_id
       and product_id     = v_product_id
       and holder_user_id is null
     for update;

    -- Stamp only the line just inserted (by id, not product_id) so a transfer
    -- with the same product on two rows doesn't cross-contaminate the second
    -- row's stamp with the post-first-decrement state.
    update public.stock_transfer_lines
       set cost_at_send_cents = v_pool_avg        -- NULL if source cost unknown
     where id = v_xfer_line_id;

    -- Decrement source pool. Removing units at avg does not change avg.
    -- If qty hits 0: avg→NULL, total→0.
    v_pool_qty  := coalesce(v_pool_qty, 0);
    v_new_qty   := greatest(v_pool_qty - v_qty, 0);
    v_new_total := case
                     when v_new_qty = 0      then 0
                     when v_pool_avg is null  then null
                     else coalesce(v_pool_total, 0) - (v_qty * v_pool_avg)
                   end;
    v_new_avg   := case when v_new_qty = 0 then null else v_pool_avg end;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      v_org_id, p_source_branch_id, null, v_product_id,
      v_new_qty, v_new_avg, v_new_total
    )
    on conflict (branch_id, product_id) where holder_user_id is null
    do update set
      quantity         = excluded.quantity,
      avg_cost_cents   = excluded.avg_cost_cents,
      total_cost_cents = excluded.total_cost_cents,
      updated_at       = now();
    -- ── END NEW ──────────────────────────────────────────────────────────────

  end loop;

  return v_transfer_id;
end;
$$;

revoke all    on function public.initiate_transfer(uuid, uuid, text, jsonb) from public;
grant execute on function public.initiate_transfer(uuid, uuid, text, jsonb) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 5. receive_transfer — weighted-average into dest pool at carried cost
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.receive_transfer(
  p_transfer_id uuid,
  p_lines       jsonb,
  p_note        text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id   uuid := auth.uid();
  v_transfer  public.stock_transfers%rowtype;
  v_line      jsonb;
  v_line_id   uuid;
  v_qty_recv  integer;
  v_xfer_line public.stock_transfer_lines%rowtype;
  -- ── NEW: cost-state accumulators ─────────────────────────────────────────
  v_pool_qty   integer;
  v_pool_avg   bigint;
  v_pool_total bigint;
  v_new_qty    integer;
  v_new_total  bigint;
  v_new_avg    bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_transfer
    from public.stock_transfers
   where id = p_transfer_id;

  if v_transfer.id is null then
    raise exception 'transfer not found';
  end if;

  if v_transfer.status <> 'in_transit' then
    raise exception 'transfer is not in transit';
  end if;

  if v_transfer.dest_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to receive stock at the destination branch';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no received lines provided';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id  := (v_line->>'line_id')::uuid;
    v_qty_recv := (v_line->>'quantity_received')::integer;

    select * into v_xfer_line
      from public.stock_transfer_lines
     where id = v_line_id
       and transfer_id = p_transfer_id;

    if v_xfer_line.id is null then
      raise exception 'line % is not part of this transfer', v_line_id;
    end if;

    if v_qty_recv is null or v_qty_recv < 0 then
      raise exception 'received quantity must be >= 0 for line %', v_line_id;
    end if;

    if v_qty_recv > v_xfer_line.quantity_sent then
      raise exception
        'cannot receive more than sent for line % (sent: %, received: %)',
        v_line_id, v_xfer_line.quantity_sent, v_qty_recv;
    end if;

    update public.stock_transfer_lines
       set quantity_received = v_qty_recv
     where id = v_line_id;

    if v_qty_recv = 0 then
      continue;
    end if;

    insert into public.stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, created_by
    ) values (
      v_transfer.organisation_id, v_transfer.dest_branch_id, v_xfer_line.product_id, v_qty_recv,
      'transfer_in', 'stock_transfer', p_transfer_id, v_user_id
    );

    -- FOR UPDATE via the upsert conflict lock; cost-state lock follows.
    insert into public.product_stock (
      organisation_id, branch_id, product_id, quantity
    ) values (
      v_transfer.organisation_id, v_transfer.dest_branch_id, v_xfer_line.product_id, v_qty_recv
    )
    on conflict (branch_id, product_id)
    do update
      set quantity   = product_stock.quantity + excluded.quantity,
          updated_at = now();

    -- ── NEW: weighted-average into dest pool at cost_at_send_cents ────────────
    -- v_xfer_line.cost_at_send_cents is NULL if source had unknown-cost units.
    select quantity, avg_cost_cents, total_cost_cents
      into v_pool_qty, v_pool_avg, v_pool_total
      from public.product_cost_state
     where branch_id      = v_transfer.dest_branch_id
       and product_id     = v_xfer_line.product_id
       and holder_user_id is null
     for update;

    v_pool_qty := coalesce(v_pool_qty, 0);
    v_new_qty  := v_pool_qty + v_qty_recv;

    if v_xfer_line.cost_at_send_cents is null then
      -- Source cost was unknown; propagate unknown to dest.
      v_new_total := null;
      v_new_avg   := null;
    elsif v_pool_qty > 0 and v_pool_avg is null then
      -- Dest pool is tainted; cannot blend known-cost arrivals.
      v_new_total := null;
      v_new_avg   := null;
    else
      -- Normal weighted-average.
      v_new_total := coalesce(v_pool_total, 0) + (v_qty_recv * v_xfer_line.cost_at_send_cents);
      v_new_avg   := v_new_total / v_new_qty;
    end if;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      v_transfer.organisation_id, v_transfer.dest_branch_id, null, v_xfer_line.product_id,
      v_new_qty, v_new_avg, v_new_total
    )
    on conflict (branch_id, product_id) where holder_user_id is null
    do update set
      quantity         = excluded.quantity,
      avg_cost_cents   = excluded.avg_cost_cents,
      total_cost_cents = excluded.total_cost_cents,
      updated_at       = now();
    -- ── END NEW ──────────────────────────────────────────────────────────────

  end loop;

  update public.stock_transfers
     set status      = 'received',
         received_by = v_user_id,
         received_at = now(),
         note        = coalesce(nullif(trim(p_note), ''), note)
   where id = p_transfer_id;

  return 'received';
end;
$$;

revoke all    on function public.receive_transfer(uuid, jsonb, text) from public;
grant execute on function public.receive_transfer(uuid, jsonb, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 6. cancel_transfer — credit units back to source pool at cost_at_send_cents
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.cancel_transfer(
  p_transfer_id uuid,
  p_note        text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_transfer public.stock_transfers%rowtype;
  v_line     public.stock_transfer_lines%rowtype;
  -- ── NEW: cost-state accumulators ─────────────────────────────────────────
  v_pool_qty   integer;
  v_pool_avg   bigint;
  v_pool_total bigint;
  v_new_qty    integer;
  v_new_total  bigint;
  v_new_avg    bigint;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_transfer
    from public.stock_transfers
   where id = p_transfer_id;

  if v_transfer.id is null then
    raise exception 'transfer not found';
  end if;

  if v_transfer.status <> 'in_transit' then
    raise exception 'only in-transit transfers can be cancelled';
  end if;

  if v_transfer.source_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to cancel this transfer';
  end if;

  for v_line in
    select * from public.stock_transfer_lines
     where transfer_id = p_transfer_id
  loop
    insert into public.stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, created_by
    ) values (
      v_transfer.organisation_id, v_transfer.source_branch_id, v_line.product_id, v_line.quantity_sent,
      'transfer_in', 'stock_transfer', p_transfer_id, v_user_id
    );

    insert into public.product_stock (
      organisation_id, branch_id, product_id, quantity
    ) values (
      v_transfer.organisation_id, v_transfer.source_branch_id, v_line.product_id, v_line.quantity_sent
    )
    on conflict (branch_id, product_id)
    do update
      set quantity   = product_stock.quantity + excluded.quantity,
          updated_at = now();

    -- ── NEW: return units to source pool at cost_at_send_cents ────────────────
    -- Mirrors the inverse of the initiate_transfer decrement.
    -- cost_at_send_cents NULL = these units had unknown cost when sent; stays unknown.
    select quantity, avg_cost_cents, total_cost_cents
      into v_pool_qty, v_pool_avg, v_pool_total
      from public.product_cost_state
     where branch_id      = v_transfer.source_branch_id
       and product_id     = v_line.product_id
       and holder_user_id is null
     for update;

    v_pool_qty := coalesce(v_pool_qty, 0);
    v_new_qty  := v_pool_qty + v_line.quantity_sent;

    if v_line.cost_at_send_cents is null then
      -- Original units had unknown cost; returning them stays unknown.
      v_new_total := null;
      v_new_avg   := null;
    elsif v_pool_qty > 0 and v_pool_avg is null then
      -- Source pool is now tainted; cannot blend returning known-cost units.
      v_new_total := null;
      v_new_avg   := null;
    else
      -- Weighted-average the returning units back in at the stamped send cost.
      v_new_total := coalesce(v_pool_total, 0) + (v_line.quantity_sent * v_line.cost_at_send_cents);
      v_new_avg   := v_new_total / v_new_qty;
    end if;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      v_transfer.organisation_id, v_transfer.source_branch_id, null, v_line.product_id,
      v_new_qty, v_new_avg, v_new_total
    )
    on conflict (branch_id, product_id) where holder_user_id is null
    do update set
      quantity         = excluded.quantity,
      avg_cost_cents   = excluded.avg_cost_cents,
      total_cost_cents = excluded.total_cost_cents,
      updated_at       = now();
    -- ── END NEW ──────────────────────────────────────────────────────────────

  end loop;

  update public.stock_transfers
     set status       = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_user_id,
         note         = coalesce(nullif(trim(p_note), ''), note)
   where id = p_transfer_id;

  return 'cancelled';
end;
$$;

revoke all    on function public.cancel_transfer(uuid, text) from public;
grant execute on function public.cancel_transfer(uuid, text) to authenticated;
