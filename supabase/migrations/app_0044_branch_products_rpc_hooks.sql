-- ─────────────────────────────────────────────────────────────────────────────
-- app_0044_branch_products_rpc_hooks.sql
--
-- ALREADY APPLIED TO PRODUCTION — repo record only, do not re-run.
-- Filed 2026-07-28. Originally applied directly to Supabase SQL editor.
-- This is the v2 (correct) version — preserves all costing logic from
-- app_0038_fifo_inflows.sql; only the branch_products INSERT hooks are new.
--
-- Source base: app_0038_fifo_inflows.sql — the last migration to touch these
-- two RPCs. The live DB bodies match app_0038 (confirmed by owner).
--
-- ONLY change vs app_0038:
--   receive_invoice_stock — one INSERT into branch_products added after the
--     `update vendor_invoice_lines set quantity_received` line, inside the loop.
--   receive_transfer      — one INSERT into branch_products added after the
--     `insert into product_stock` upsert, inside the v_qty_recv > 0 path.
--
-- Every other line is byte-identical to app_0038.
-- No changes to: cost_layers, product_cost_state, cogs_allocations,
-- drain_fifo_layers, fifo_add_layer, stock_ledger writes, product_stock,
-- transfer_cost_layers, or any other existing logic.
--
-- Depends on: app_0038_fifo_inflows (functions being replaced)
--             app_0043_branch_products (branch_products table + PK constraint)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. receive_invoice_stock
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Addition vs app_0038:
--   After `update vendor_invoice_lines set quantity_received`, inside the loop:
--
--     insert into public.branch_products (organisation_id, branch_id, product_id)
--     values (v_inv.organisation_id, v_inv.branch_id, v_il.product_id)
--     on conflict (branch_id, product_id) do nothing;
--
-- All other lines byte-identical to app_0038 lines 120-277.

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

    -- ── NEW (branch_products) ─────────────────────────────────────────────────
    insert into public.branch_products (organisation_id, branch_id, product_id)
    values (v_inv.organisation_id, v_inv.branch_id, v_il.product_id)
    on conflict (branch_id, product_id) do nothing;
    -- ── END NEW ───────────────────────────────────────────────────────────────

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
-- ║ 2. receive_transfer
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Addition vs app_0038:
--   After the `insert into public.product_stock ... on conflict do update`
--   upsert, inside the v_qty_recv > 0 path:
--
--     insert into public.branch_products (organisation_id, branch_id, product_id)
--     values (v_transfer.organisation_id, v_transfer.dest_branch_id, v_xfer_line.product_id)
--     on conflict (branch_id, product_id) do nothing;
--
-- All other lines byte-identical to app_0038 lines 834-1029.

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
      organisation_id,
      branch_id,
      product_id,
      quantity_delta,
      reason,
      reference_type,
      reference_id,
      created_by
    ) values (
      v_transfer.organisation_id,
      v_transfer.dest_branch_id,
      v_xfer_line.product_id,
      v_qty_recv,        -- stock ARRIVES at destination branch
      'transfer_in',
      'stock_transfer',
      p_transfer_id,
      v_user_id
    );

    -- FOR UPDATE via the upsert conflict lock; cost-state lock follows.
    insert into public.product_stock (
      organisation_id,
      branch_id,
      product_id,
      quantity
    ) values (
      v_transfer.organisation_id,
      v_transfer.dest_branch_id,
      v_xfer_line.product_id,
      v_qty_recv
    )
    on conflict (branch_id, product_id)
    do update
      set quantity   = product_stock.quantity + excluded.quantity,
          updated_at = now();

    -- ── NEW (branch_products) ─────────────────────────────────────────────────
    insert into public.branch_products (organisation_id, branch_id, product_id)
    values (v_transfer.organisation_id, v_transfer.dest_branch_id, v_xfer_line.product_id)
    on conflict (branch_id, product_id) do nothing;
    -- ── END NEW ───────────────────────────────────────────────────────────────

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
