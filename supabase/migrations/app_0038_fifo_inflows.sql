-- ─────────────────────────────────────────────────────────────────────────────
-- app_0038_fifo_inflows.sql
--
-- Wires FIFO layer maintenance into the five inflow / movement RPCs.
-- Adds the fifo_add_layer() helper and replaces each function so that both
-- product_cost_state (weighted) and cost_layers (FIFO) are kept in sync for
-- every stock movement — regardless of the org's active costing_method.
--
-- Functions changed:
--   1. fifo_add_layer()         — NEW helper (internal only)
--   2. receive_invoice_stock()  — diff A: create layer at vendor receipt
--   3. review_stock_request()   — diff B: drain pool layers, recreate at holder
--   4. initiate_transfer()      — diff D: drain source layers, snapshot to transit
--   5. receive_transfer()       — diff C: recreate layers at destination
--   6. cancel_transfer()        — diff E: restore transit layers to source pool
--
-- Coexistence rule (non-negotiable, holds forever):
--   Both engines are maintained in parallel on every write. The org's
--   costing_method only determines which engine drives COGS at consumption time
--   (record_sale / record_service_usage — covered in step 2d).
--
-- Partial-receipt rule (receive_transfer):
--   transfer_cost_layers is immutable after initiate_transfer. At receive_transfer
--   we walk the line's lots oldest-first and recreate up to v_qty_recv units at
--   the destination. Any lot units beyond v_qty_recv are "transit loss" — not
--   recreated at dest. This mirrors the existing weighted engine's behaviour:
--   product_cost_state is only built for units actually received.
--
-- FIFO shortfall on drain:
--   drain_fifo_layers() RAISES if cost_layers cannot cover the requested quantity.
--   This means stock and cost_layers are out of sync. It is intentional and safe
--   to surface loudly — a silent partial drain would produce wrong COGS. Existing
--   stock that pre-dates app_0036 has no layers; the opening-layer migration
--   (step 2e) must be applied before those units are moved under FIFO.
--
-- Lock order (unchanged):
--   product_stock FOR UPDATE
--     → product_cost_state FOR UPDATE  (pool, then holder)
--       → cost_layers FOR UPDATE       (inside drain_fifo_layers)
--
-- Depends on:
--   app_0034_costing_inflows  (functions being replaced)
--   app_0036_fifo_schema      (cost_layers, transfer_cost_layers, cost_layer_seq)
--   app_0037_fifo_drain       (fifo_drain_row type, drain_fifo_layers function)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 0. fifo_add_layer — internal helper: insert one cost_layers row
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Called by every inflow / move that creates or transfers a FIFO lot.
--
-- p_original_seq:
--   NULL  → new stock entering the system; nextval('cost_layer_seq') is called
--           here and the fresh sequence is stored. COALESCE short-circuits: nextval
--           is NOT called when p_original_seq is already provided.
--   non-null → lot is being moved (pool→holder, branch→branch, cancel return).
--           The provided value is stored unchanged — never regenerated on a move.
--
-- p_unit_cost_cents:
--   NULL → unknown-cost lot (source had no cost information). Stored as NULL,
--   propagates through all subsequent moves and is surfaced to COGS as NULL.
--
-- Security: SECURITY DEFINER, REVOKE from PUBLIC. Only callable by other
-- security-definer RPCs owned by the same postgres role.

create or replace function public.fifo_add_layer(
  p_org_id          uuid,
  p_branch_id       uuid,
  p_holder_user_id  uuid,       -- NULL = branch pool; set = staff holding
  p_product_id      uuid,
  p_quantity        integer,
  p_unit_cost_cents bigint,     -- NULL = unknown cost
  p_original_seq    bigint,     -- NULL = new stock (assign nextval); non-null = carry
  p_source_ref_type text,
  p_source_ref_id   uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'fifo_add_layer: quantity must be > 0 (got %)', p_quantity;
  end if;

  insert into public.cost_layers (
    organisation_id, branch_id, holder_user_id, product_id,
    original_seq, qty_remaining, unit_cost_cents,
    source_ref_type, source_ref_id
  ) values (
    p_org_id, p_branch_id, p_holder_user_id, p_product_id,
    coalesce(p_original_seq, nextval('public.cost_layer_seq')),
    p_quantity,
    p_unit_cost_cents,
    p_source_ref_type,
    p_source_ref_id
  );
end;
$$;

-- Internal helper — never callable by authenticated users directly.
-- Security-definer callers owned by the same postgres role can invoke it via
-- owner privilege; no explicit EXECUTE grant is needed or wanted.
revoke all on function public.fifo_add_layer(
  uuid, uuid, uuid, uuid, integer, bigint, bigint, text, uuid
) from public;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ A. receive_invoice_stock — diff: create FIFO layer for received batch
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Addition: after the weighted product_cost_state upsert, call fifo_add_layer
-- with p_original_seq=NULL → nextval assigns a fresh global seq (new stock).
--
-- No DECLARE changes needed — all required variables already exist.

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
  -- ── weighted cost-state accumulators ─────────────────────────────────────
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

    -- ── weighted-average cost into branch pool ────────────────────────────────
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
    -- ── END weighted ──────────────────────────────────────────────────────────

    -- ── NEW (FIFO): create a lot for this received batch ──────────────────────
    -- p_original_seq=NULL → fifo_add_layer assigns a fresh global seq via nextval.
    -- This is new stock entering the system for the first time; it must never
    -- carry a pre-existing seq (that would corrupt the global FIFO order).
    -- unit_cost_cents carries directly from the invoice line — same as weighted.
    perform public.fifo_add_layer(
      v_inv.organisation_id,
      v_inv.branch_id,
      null,                     -- branch pool bucket (holder_user_id = null)
      v_il.product_id,
      v_batch,
      v_il.unit_cost_cents,     -- NULL only if invoice line had no cost (edge case)
      null,                     -- new stock → assign fresh seq
      'vendor_invoice',
      p_invoice_id
    );
    -- ── END NEW (FIFO) ────────────────────────────────────────────────────────

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
-- ║ B. review_stock_request — diff: drain pool layers, recreate at holder
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Addition to DECLARE: v_fifo_row public.fifo_drain_row
--
-- After the weighted holder bucket upsert:
--   drain_fifo_layers() removes lot units from the pool bucket oldest-first,
--   returning one fifo_drain_row per lot touched. fifo_add_layer() then
--   recreates each drained lot in the holder bucket CARRYING its original_seq.
--   This preserves the global FIFO order across bucket boundaries: a January lot
--   remains the oldest in any bucket it lands in, regardless of when it was issued.

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
  -- ── weighted cost-state accumulators ─────────────────────────────────────
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
  -- ── NEW (FIFO) ────────────────────────────────────────────────────────────
  v_fifo_row      public.fifo_drain_row;
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

    -- ── weighted cost state — move cost pool → holder ─────────────────────────
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
    -- ── END weighted ──────────────────────────────────────────────────────────

    -- ── NEW (FIFO): move lots pool → holder, carrying original_seq ────────────
    -- drain_fifo_layers() takes v_qty_approved units from the pool bucket
    -- oldest-first (FOR UPDATE; no SKIP LOCKED). For each drained lot we call
    -- fifo_add_layer() to recreate the lot in the holder bucket at the SAME
    -- original_seq. The sequence is never regenerated on a move — that is what
    -- makes FIFO truly global across bucket boundaries.
    --
    -- If cost_layers is short (pre-FIFO stock), drain_fifo_layers raises.
    -- This is intentional; apply the opening-layer migration before moving
    -- pre-existing stock under FIFO.
    for v_fifo_row in
      select * from public.drain_fifo_layers(
        v_req.organisation_id,
        v_req.branch_id,
        null,                      -- drain from pool bucket
        v_req_line.product_id,
        v_qty_approved
      )
    loop
      perform public.fifo_add_layer(
        v_req.organisation_id,
        v_req.branch_id,
        v_req.requested_by,        -- recreate in holder bucket
        v_req_line.product_id,
        v_fifo_row.qty_consumed,
        v_fifo_row.unit_cost_cents, -- carry cost; NULL propagates as-is
        v_fifo_row.original_seq,    -- CARRY seq — never regenerate on a move
        'issue_to_holding',
        p_request_id
      );
    end loop;
    -- ── END NEW (FIFO) ────────────────────────────────────────────────────────

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
-- ║ D. initiate_transfer — diff: drain source layers, snapshot to transit
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Addition to DECLARE: v_fifo_row public.fifo_drain_row
--
-- After the weighted product_cost_state source-pool upsert:
--   drain_fifo_layers() removes lots from the source pool bucket oldest-first.
--   Each drained lot is snapshotted into transfer_cost_layers (one row per lot)
--   using INSERT...SELECT directly from the drain result — no intermediate
--   accumulator variable needed.
--   original_seq is carried unchanged into transfer_cost_layers so that
--   receive_transfer can recreate the lots at the destination in global FIFO order.

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
  -- ── weighted cost-state accumulators + per-line id for precise stamp ──────
  v_xfer_line_id uuid;
  v_pool_qty     integer;
  v_pool_avg     bigint;
  v_pool_total   bigint;
  v_new_qty      integer;
  v_new_total    bigint;
  v_new_avg      bigint;
  -- ── NEW (FIFO) ────────────────────────────────────────────────────────────
  v_fifo_row     public.fifo_drain_row;
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

    -- ── weighted: stamp cost at send + decrement source pool ──────────────────
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
    -- ── END weighted ──────────────────────────────────────────────────────────

    -- ── NEW (FIFO): drain source lots, snapshot into transfer_cost_layers ─────
    -- drain_fifo_layers() locks and decrements source pool lots oldest-first.
    -- INSERT...SELECT directly snapshots each drained lot into transfer_cost_layers;
    -- original_seq is carried unchanged so the destination can honour global FIFO.
    -- unit_cost_cents NULL (unknown-cost lot) propagates through transit as NULL.
    --
    -- v_xfer_line_id identifies exactly this line (set above via RETURNING) so
    -- that when the same product appears twice in one transfer, each line's lot
    -- snapshot is kept separate.
    for v_fifo_row in
      select * from public.drain_fifo_layers(
        v_org_id,
        p_source_branch_id,
        null,                      -- drain from source pool bucket
        v_product_id,
        v_qty
      )
    loop
      insert into public.transfer_cost_layers (
        organisation_id, transfer_line_id, original_seq, quantity, unit_cost_cents
      ) values (
        v_org_id,
        v_xfer_line_id,
        v_fifo_row.original_seq,
        v_fifo_row.qty_consumed,
        v_fifo_row.unit_cost_cents  -- NULL propagates (unknown lot stays unknown in transit)
      );
    end loop;
    -- ── END NEW (FIFO) ────────────────────────────────────────────────────────

  end loop;

  return v_transfer_id;
end;
$$;

revoke all    on function public.initiate_transfer(uuid, uuid, text, jsonb) from public;
grant execute on function public.initiate_transfer(uuid, uuid, text, jsonb) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ C. receive_transfer — diff: recreate carried lots at destination
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Additions to DECLARE:
--   v_tcl_row       record           — one transfer_cost_layers row per iteration
--   v_fifo_qty_left integer          — units still to allocate in this receive batch
--   v_lot_take      integer          — units to take from the current lot
--
-- After the weighted product_cost_state dest-pool upsert (inside the v_qty_recv > 0
-- path):
--   Walk transfer_cost_layers for this line in original_seq ASC (oldest-first).
--   Take min(lot.quantity, remaining) until v_qty_recv units are allocated.
--   Create a cost_layers row at the destination for each taken portion, carrying
--   the original_seq so the destination respects the global FIFO order.
--
-- Partial-receipt rule:
--   transfer_cost_layers is immutable (never updated here). If v_qty_recv < the
--   total units sent for this line, lot units beyond v_qty_recv are not recreated
--   at the destination — they are "transit loss", matching the existing weighted
--   engine's behaviour (product_cost_state is only built for actually received units).
--   source_ref_id = p_transfer_id makes the originating transfer traceable in cost_layers.

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
  -- ── weighted cost-state accumulators ─────────────────────────────────────
  v_pool_qty   integer;
  v_pool_avg   bigint;
  v_pool_total bigint;
  v_new_qty    integer;
  v_new_total  bigint;
  v_new_avg    bigint;
  -- ── NEW (FIFO) ────────────────────────────────────────────────────────────
  v_tcl_row       record;
  v_fifo_qty_left integer;
  v_lot_take      integer;
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

    -- ── weighted: average into dest pool at cost_at_send_cents ───────────────
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
    -- ── END weighted ──────────────────────────────────────────────────────────

    -- ── NEW (FIFO): recreate carried lots at destination ──────────────────────
    -- Walk transfer_cost_layers for this line in original_seq ASC (oldest-first).
    -- Take min(lot.quantity, v_fifo_qty_left) from each lot until the received
    -- quantity is fully allocated. Lots (or lot portions) beyond v_qty_recv are
    -- not recreated — transit loss, same semantics as the weighted engine.
    --
    -- transfer_cost_layers is immutable: we never UPDATE it here.
    -- Partial-lot splits at the receive boundary are handled by v_lot_take < lot.quantity.
    v_fifo_qty_left := v_qty_recv;

    for v_tcl_row in
      select original_seq, quantity, unit_cost_cents
        from public.transfer_cost_layers
       where transfer_line_id = v_xfer_line.id
       order by original_seq asc
    loop
      exit when v_fifo_qty_left = 0;

      v_lot_take := least(v_tcl_row.quantity, v_fifo_qty_left);

      perform public.fifo_add_layer(
        v_transfer.organisation_id,
        v_transfer.dest_branch_id,
        null,                         -- dest pool bucket
        v_xfer_line.product_id,
        v_lot_take,
        v_tcl_row.unit_cost_cents,    -- carry cost; NULL propagates
        v_tcl_row.original_seq,       -- carry seq — global FIFO order at destination
        'transfer_in',
        p_transfer_id
      );

      v_fifo_qty_left := v_fifo_qty_left - v_lot_take;
    end loop;
    -- ── END NEW (FIFO) ────────────────────────────────────────────────────────

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
-- ║ E. cancel_transfer — diff: restore transit lots to source pool
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Addition to DECLARE: v_tcl_row record
--
-- After the weighted product_cost_state source-pool upsert (inside the line loop):
--   Read transfer_cost_layers for this line in original_seq ASC order.
--   Call fifo_add_layer() for each lot, returning units to the source pool at
--   the same original_seq — restoring the lot to its correct global FIFO position.
--
-- source_ref_type = 'transfer_in': units are arriving at the source branch
-- (as a credit from cancelled transit). source_ref_id = p_transfer_id gives
-- the audit trace. Querying by source_ref_type='transfer_in' + reference to the
-- transfer UUID identifies these as cancellation credits, not normal inbounds.

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
  -- ── weighted cost-state accumulators ─────────────────────────────────────
  v_pool_qty   integer;
  v_pool_avg   bigint;
  v_pool_total bigint;
  v_new_qty    integer;
  v_new_total  bigint;
  v_new_avg    bigint;
  -- ── NEW (FIFO) ────────────────────────────────────────────────────────────
  v_tcl_row    record;
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

    -- ── weighted: return units to source pool at cost_at_send_cents ───────────
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
    -- ── END weighted ──────────────────────────────────────────────────────────

    -- ── NEW (FIFO): restore transit lots to source pool ───────────────────────
    -- Read transfer_cost_layers for this line in original_seq ASC (oldest-first).
    -- Recreate each lot in the source pool, carrying the original_seq so these
    -- units return to their correct position in the global FIFO drain order.
    -- transfer_cost_layers is immutable — we read but never UPDATE it.
    for v_tcl_row in
      select original_seq, quantity, unit_cost_cents
        from public.transfer_cost_layers
       where transfer_line_id = v_line.id
       order by original_seq asc
    loop
      perform public.fifo_add_layer(
        v_transfer.organisation_id,
        v_transfer.source_branch_id,
        null,                        -- source pool bucket
        v_line.product_id,
        v_tcl_row.quantity,
        v_tcl_row.unit_cost_cents,   -- carry cost; NULL propagates
        v_tcl_row.original_seq,      -- carry seq — restores original FIFO position
        'transfer_in',
        p_transfer_id
      );
    end loop;
    -- ── END NEW (FIFO) ────────────────────────────────────────────────────────

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
