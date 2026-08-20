-- ─────────────────────────────────────────────────────────────────────────────
-- app_0054_services_pricing.sql
--
-- Merges sellable services into the existing service_types catalog.
-- service_types already has live data and owns the FK from service_records,
-- so we ADD default_price_cents to service_types — zero data migration.
-- "Facial" and all service_records history are untouched.
--
-- Tables added/modified:
--   service_types        — ADD default_price_cents bigint NOT NULL DEFAULT 0
--   sale_service_lines   — new: one row per service fee on a sale.
--                          service_type_id FK → service_types ON DELETE SET NULL
--                          (nullable; history survives catalog deletions).
--                          service_name denormalized so history survives renames.
--   sales                — ADD service_revenue_cents (service portion of subtotal
--                          for revenue-split reporting).
--
-- RPC:
--   record_sale — rebuilt from app_0053 with p_service_lines jsonb DEFAULT '[]':
--     • p_service_lines format: [{service_type_id?, service_name,
--                                 unit_price_cents, quantity}]
--     • service_type_id optional (null = ad-hoc fee, always allowed).
--     • Combined "at least one product or service" guard.
--     • Service loop: no stock, no COGS — pure revenue rows.
--     • v_total  = product line total (unchanged).
--     • v_svc_total = service line total (new).
--     • subtotal = v_total + v_svc_total. VAT on combined subtotal.
--     • service_revenue_cents = v_svc_total written to sales header.
--     Product-costing logic (drain_fifo_layers, cogs_allocations,
--     product_cost_state) is byte-identical to app_0053_sale_vat.sql.
--
-- record_service_usage — UNCHANGED. Continues to reference service_types.
--
-- Depends on: app_0001_core (set_updated_at, organisations)
--             app_0007_products_rls (user_member_org_ids,
--                                    user_product_write_org_ids)
--             app_0009_vendors_rls (user_vendor_read_branch_ids)
--             app_0024_sales (sales, sale_lines, user_readable_sale_ids)
--             app_0026_service_usage (service_types table)
--             app_0053_sale_vat (current record_sale signature, subtotal_cents,
--                               vat_rate, vat_cents, sales_total_check)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. Extend service_types with a sellable price column
-- ╚══════════════════════════════════════════════════════════════════════════════

alter table public.service_types
  add column if not exists default_price_cents bigint not null default 0
    check (default_price_cents >= 0);


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. sale_service_lines
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.sale_service_lines (
  id                uuid    primary key default gen_random_uuid(),
  sale_id           uuid    not null references public.sales (id) on delete cascade,
  service_type_id   uuid    references public.service_types (id) on delete set null,
  service_name      text    not null,
  quantity          integer not null check (quantity > 0),
  unit_price_cents  bigint  not null check (unit_price_cents >= 0),
  line_total_cents  bigint  not null,
  constraint sale_service_lines_total_check
    check (line_total_cents = quantity * unit_price_cents)
);

create index sale_service_lines_sale_idx
  on public.sale_service_lines (sale_id);

-- ── RLS ────────────────────────────────────────────────────────────────────────

alter table public.sale_service_lines enable row level security;
alter table public.sale_service_lines force row level security;

-- Visible if and only if the parent sale is visible.
-- user_readable_sale_ids() is security-definer (app_0024) — avoids RLS recursion.
create policy "sale_service_lines: readable with parent sale"
  on public.sale_service_lines
  for select
  using (sale_id in (select public.user_readable_sale_ids()));

-- No INSERT / UPDATE / DELETE policies — all writes via record_sale RPC.

-- ── Grants ─────────────────────────────────────────────────────────────────────

revoke all on table public.sale_service_lines from public;
grant select on table public.sale_service_lines to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 3. sales.service_revenue_cents
-- ╚══════════════════════════════════════════════════════════════════════════════

-- Tracks only the service portion of subtotal_cents for revenue-split reporting.
-- subtotal_cents = product total + service total (combined). Callers derive
-- product_revenue_cents = subtotal_cents - service_revenue_cents.
alter table public.sales
  add column if not exists service_revenue_cents bigint not null default 0
    check (service_revenue_cents >= 0);


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 4. Drop old record_sale signature (app_0053: 9 params, no p_service_lines)
-- ╚══════════════════════════════════════════════════════════════════════════════

drop function if exists public.record_sale(uuid, text, text, date, text, text, text, jsonb, numeric);


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 5. record_sale — rebuilt with p_service_lines
-- ║
-- ║    Product-costing logic from declare block through the product end loop
-- ║    is byte-identical to app_0053_sale_vat.sql. New additions (service loop,
-- ║    combined subtotal) are clearly marked NEW / END NEW.
-- ║    One intentional deviation from byte-identical: jsonb_array_elements uses
-- ║    coalesce(p_lines, '[]') so a service-only sale (p_lines = '[]') does not
-- ║    error at the loop even if p_lines arrives null from a direct RPC call.
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
  p_vat_rate       numeric default null,
  p_service_lines  jsonb   default '[]'
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
  -- VAT accumulators (unchanged from app_0053)
  v_subtotal   bigint;
  v_vat        bigint;
  -- service line accumulators (new in app_0054)
  v_svc_line     jsonb;
  v_svc_type_id  uuid;
  v_svc_name     text;
  v_svc_qty      integer;
  v_svc_price    bigint;
  v_svc_total    bigint := 0;
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

  -- ── NEW: combined guard (products OR services required) ────────────────────
  if (p_lines is null or jsonb_array_length(p_lines) = 0)
     and (p_service_lines is null or jsonb_array_length(p_service_lines) = 0) then
    raise exception 'a sale must have at least one product or service line';
  end if;
  -- ── END NEW ────────────────────────────────────────────────────────────────

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

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'))
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

  -- ── NEW: service lines loop ────────────────────────────────────────────────
  -- No stock movement, no COGS. Pure revenue rows inserted into sale_service_lines.
  for v_svc_line in select * from jsonb_array_elements(coalesce(p_service_lines, '[]'))
  loop
    v_svc_type_id := (v_svc_line->>'service_type_id')::uuid;
    v_svc_name    := v_svc_line->>'service_name';
    v_svc_qty     := (v_svc_line->>'quantity')::integer;
    v_svc_price   := (v_svc_line->>'unit_price_cents')::bigint;

    if v_svc_qty is null or v_svc_qty <= 0 then
      raise exception 'service line quantity must be greater than 0';
    end if;

    if v_svc_price is null or v_svc_price < 0 then
      raise exception 'service line price must be 0 or greater';
    end if;

    if v_svc_name is null or trim(v_svc_name) = '' then
      raise exception 'service line must have a name';
    end if;

    -- Validate service_type_id when provided. null = ad-hoc fee, always allowed.
    if v_svc_type_id is not null then
      if not exists (
        select 1
          from public.service_types
         where id              = v_svc_type_id
           and organisation_id = v_org_id
           and is_active       = true
           and deleted_at      is null
      ) then
        raise exception 'service type not found or inactive';
      end if;
    end if;

    insert into public.sale_service_lines (
      sale_id, service_type_id, service_name,
      quantity, unit_price_cents, line_total_cents
    ) values (
      v_sale_id, v_svc_type_id, trim(v_svc_name),
      v_svc_qty, v_svc_price, v_svc_qty * v_svc_price
    );

    v_svc_total := v_svc_total + (v_svc_qty * v_svc_price);
  end loop;
  -- ── END NEW ────────────────────────────────────────────────────────────────

  -- ── VAT computation — subtotal now includes service revenue ───────────────
  -- v_total    = product line total.   v_svc_total = service line total.
  -- VAT on combined subtotal. COGS / margin metrics use product lines only.
  v_subtotal := v_total + v_svc_total;
  v_vat      := round(v_subtotal * coalesce(p_vat_rate, 0) / 100.0);
  v_total    := v_subtotal + v_vat;

  update public.sales
     set subtotal_cents        = v_subtotal,
         vat_rate              = p_vat_rate,
         vat_cents             = v_vat,
         total_cents           = v_total,
         service_revenue_cents = v_svc_total,
         amount_paid_cents     = case
                                   when p_payment_status = 'paid' then v_total
                                   else 0
                                 end
   where id = v_sale_id;

  return v_sale_id;
end;
$$;

revoke all    on function public.record_sale(uuid, text, text, date, text, text, text, jsonb, numeric, jsonb) from public;
grant execute on function public.record_sale(uuid, text, text, date, text, text, text, jsonb, numeric, jsonb) to authenticated;
