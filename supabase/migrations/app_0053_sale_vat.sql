-- ─────────────────────────────────────────────────────────────────────────────
-- app_0053_sale_vat.sql
--
-- Adds VAT tracking to the sales table. Mirrors the vendor_invoices pattern
-- (app_0032): subtotal_cents (goods total) + vat_cents = total_cents.
-- Existing rows backfilled: subtotal_cents = total_cents, vat_cents = 0
-- (no VAT was ever charged historically, so subtotal = total is correct).
--
-- Also rebuilds record_sale with a new p_vat_rate param. The old signature
-- (8 args, no vat_rate) is dropped first because PostgreSQL treats a new
-- parameter as a different overload. ALL costing logic (FIFO/weighted,
-- drain_fifo_layers, cogs_allocations, product_cost_state) is byte-identical
-- to app_0040_fifo_outflows.sql — only the VAT computation and the final
-- UPDATE are extended.
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. Extend the sales table
-- ╚══════════════════════════════════════════════════════════════════════════════

alter table public.sales
  add column if not exists subtotal_cents bigint not null default 0,
  add column if not exists vat_rate       numeric,
  add column if not exists vat_cents      bigint not null default 0;

-- Backfill existing rows (no VAT was charged before this migration)
update public.sales
   set subtotal_cents = total_cents,
       vat_rate       = null,
       vat_cents      = 0
 where subtotal_cents = 0;

-- Enforce the invariant (add after backfill so existing rows pass)
alter table public.sales
  add constraint sales_total_check check (total_cents = subtotal_cents + vat_cents);


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. Drop old record_sale signature (arg list changes → create or replace
-- ║    would leave the old overload alive and the JS client would be ambiguous)
-- ╚══════════════════════════════════════════════════════════════════════════════

drop function if exists public.record_sale(uuid, text, text, date, text, text, text, jsonb);


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 3. record_sale — rebuilt with p_vat_rate
-- ║
-- ║    Costing logic (lines through "END CHANGED") is byte-identical to
-- ║    app_0040_fifo_outflows. Only the declare block (two new vars) and the
-- ║    block after `end loop` (VAT computation + extended UPDATE) are new.
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.record_sale(
  p_branch_id      uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_sold_on        date,
  p_note           text,
  p_payment_method text,
  p_payment_status text,
  p_lines          jsonb,
  p_vat_rate       numeric default null
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
  -- costing accumulators (unchanged from app_0035/app_0040)
  v_org_costing_method text;
  v_sale_line_id       uuid;
  v_holder_qty         integer;
  v_holder_avg         bigint;
  v_holder_total       bigint;
  v_cogs_cents         bigint;
  v_cost_known         boolean;
  v_new_qty            integer;
  v_new_total          bigint;
  -- VAT accumulators (new in app_0053)
  v_subtotal   bigint;
  v_vat        bigint;
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

    -- FOR UPDATE on staff_holdings. Cost-state + cost_layers locks follow below.
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

    -- ── common: lock holder product_cost_state ────────────────────────────────
    -- staff_holdings already locked above; cost-state lock follows.
    -- Read in both modes: FIFO still needs holder_avg to decrement product_cost_state.
    select quantity, avg_cost_cents, total_cost_cents
      into v_holder_qty, v_holder_avg, v_holder_total
      from public.product_cost_state
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id
     for update;

    v_holder_qty := coalesce(v_holder_qty, 0);

    -- ── CHANGED (FIFO branch): COGS source depends on costing_method ──────────
    if v_org_costing_method = 'fifo' then
      -- FIFO: drain holder cost_layers oldest-first. One row returned per drained lot.
      -- SELECT...INTO aggregates across all lots: sum for COGS, bool_and for cost_known.
      -- If any lot has unit_cost_cents NULL → whole COGS is NULL (unknown-cost lot).
      -- cost_layers.qty_remaining is decremented inside drain_fifo_layers.
      -- cost_layers FOR UPDATE acquired here — after product_cost_state above.
      select
        case
          when bool_and(d.unit_cost_cents is not null)
            then sum(d.qty_consumed::bigint * d.unit_cost_cents)
          else null
        end,
        coalesce(bool_and(d.unit_cost_cents is not null), false)
      into v_cogs_cents, v_cost_known
      from public.drain_fifo_layers(
        v_org_id, p_branch_id, v_user_id, v_product_id, v_qty
      ) d;

    else
      -- WEIGHTED (default): COGS = qty × holder_avg at this moment.
      -- NULL avg = unknown cost → cogs_cents NULL, cost_known false. Never 0.
      if v_holder_avg is not null then
        v_cogs_cents := v_qty * v_holder_avg;
        v_cost_known := true;
      else
        v_cogs_cents := null;
        v_cost_known := false;
      end if;
    end if;
    -- ── END CHANGED ────────────────────────────────────────────────────────────

    -- ── common: freeze COGS into cogs_allocations ─────────────────────────────
    insert into public.cogs_allocations (
      organisation_id, branch_id, product_id,
      reference_type, reference_id,
      quantity, cogs_cents, cost_known, method_used
    ) values (
      v_org_id, p_branch_id, v_product_id,
      'sale_line', v_sale_line_id,
      v_qty, v_cogs_cents, v_cost_known,
      case when v_org_costing_method = 'fifo' then 'fifo' else 'weighted' end
    );

    -- ── common: decrement holder product_cost_state ───────────────────────────
    -- product_cost_state is the weighted engine. Decrement always uses holder_avg × qty
    -- — NOT v_cogs_cents. In FIFO mode v_cogs_cents holds FIFO lot costs; using it
    -- here would corrupt the weighted running total. In weighted mode, holder_avg × qty
    -- equals v_cogs_cents when avg is known, so no semantic change for that path.
    -- Removing units at avg does NOT change avg; qty → 0 resets avg→NULL, total→0.
    v_new_qty   := greatest(v_holder_qty - v_qty, 0);
    v_new_total := case
                     when v_new_qty = 0        then 0
                     when v_holder_avg is null  then null
                     else coalesce(v_holder_total, 0) - (v_qty * v_holder_avg)
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

    -- ── NEW (FIFO sync): weighted mode drains cost_layers to keep qty matched ──
    -- In FIFO mode, cost_layers was already drained by drain_fifo_layers above.
    -- In weighted mode, drain now with result discarded so that cost_layers.qty_remaining
    -- decrements in lockstep with product_cost_state.quantity.
    -- Lock order holds: product_cost_state lock was acquired above.
    if v_org_costing_method <> 'fifo' then
      perform public.drain_fifo_layers(
        v_org_id, p_branch_id, v_user_id, v_product_id, v_qty
      );
    end if;
    -- ── END NEW ────────────────────────────────────────────────────────────────

  end loop;

  -- ── VAT computation (new in app_0053) ─────────────────────────────────────
  -- v_total at this point = sum of line_total_cents (goods subtotal).
  -- VAT is added on top; COGS / margin use line_total_cents, never v_vat.
  v_subtotal := v_total;
  v_vat      := round(v_subtotal * coalesce(p_vat_rate, 0) / 100.0);
  v_total    := v_subtotal + v_vat;

  update public.sales
     set subtotal_cents    = v_subtotal,
         vat_rate          = p_vat_rate,
         vat_cents         = v_vat,
         total_cents       = v_total,
         amount_paid_cents = case
                               when p_payment_status = 'paid' then v_total
                               else 0
                             end
   where id = v_sale_id;

  return v_sale_id;
end;
$$;

revoke all    on function public.record_sale(uuid, text, text, date, text, text, text, jsonb, numeric) from public;
grant execute on function public.record_sale(uuid, text, text, date, text, text, text, jsonb, numeric) to authenticated;
