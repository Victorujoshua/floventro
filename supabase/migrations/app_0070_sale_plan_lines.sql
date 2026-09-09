-- ─────────────────────────────────────────────────────────────────────────────
-- app_0070_sale_plan_lines.sql
--
-- Fixes invoice plan-line visibility: client_plans had no sale_id FK so the
-- invoice page could never query which plans were purchased in a given sale.
-- Plan-only sales showed correct totals but zero line rows on the invoice.
--
-- Changes:
--   1. New table: sale_plan_lines — one row per plan purchased within a sale.
--      Columns: sale_id FK, plan_id FK (nullable ON DELETE SET NULL), plan_name
--      snapshot (immutable), sessions_total snapshot, price_paid_cents.
--      RLS mirrors sale_service_lines: readable via user_readable_sale_ids().
--
--   2. record_sale (12-param) — declare block: + v_plan_name text.
--      Plan-lines loop: snapshot plan name from plans, then INSERT into
--      sale_plan_lines immediately after the client_plans INSERT.
--      Everything else is byte-identical to app_0069_record_sale_pool.
--
-- NOTE: existing plan sales (created before this migration) have no rows in
--   sale_plan_lines. Their invoice will still show plan_revenue_cents in the
--   totals but no plan line rows. Only sales recorded after migration apply
--   will have plan lines on the invoice.
--
-- Depends on:
--   app_0024_sales   (sales, sale_lines, user_readable_sale_ids)
--   app_0057         (plans, plan_lines, client_plans)
--   app_0067         (record_sale 12-param baseline)
--   app_0068         (relax holder constraint — pool sales)
--   app_0069         (record_sale pool path — current live function)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. sale_plan_lines table
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.sale_plan_lines (
  id               uuid    primary key default gen_random_uuid(),
  sale_id          uuid    not null references public.sales(id) on delete cascade,
  plan_id          uuid    references public.plans(id) on delete set null,
  -- plan_name: snapshot at time of sale — not affected by later renames or deletes.
  plan_name        text    not null,
  -- sessions_total: snapshot from plan_lines at time of sale.
  sessions_total   integer not null check (sessions_total > 0),
  price_paid_cents bigint  not null check (price_paid_cents >= 0)
);

create index sale_plan_lines_sale_idx on public.sale_plan_lines (sale_id);

alter table public.sale_plan_lines enable row level security;
alter table public.sale_plan_lines force row level security;

-- Readable if and only if the parent sale is readable.
create policy "sale_plan_lines: readable with parent sale"
  on public.sale_plan_lines
  for select
  using (sale_id in (select public.user_readable_sale_ids()));

-- No INSERT / UPDATE / DELETE user policies — all writes via record_sale RPC.

revoke all on table public.sale_plan_lines from public;
grant select on table public.sale_plan_lines to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. record_sale — 12-param, adds sale_plan_lines insert in plan loop.
-- ║
-- ║    Base: app_0069_record_sale_pool (current live function).
-- ║    Changes vs app_0069 are marked NEW / END NEW.
-- ║    All other code is byte-identical to app_0069.
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
  p_service_lines  jsonb   default '[]',
  p_client_id      uuid    default null,
  p_plan_lines     jsonb   default '[]'
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
  -- service line accumulators (unchanged from app_0054)
  v_svc_line     jsonb;
  v_svc_type_id  uuid;
  v_svc_name     text;
  v_svc_qty      integer;
  v_svc_price    bigint;
  v_svc_total    bigint := 0;
  -- plan line accumulators (unchanged from app_0067)
  v_plan_line      jsonb;
  v_plan_id        uuid;
  v_price_paid     bigint;
  v_sessions_total integer;
  v_plan_total     bigint := 0;
  -- pool-selling (unchanged from app_0069)
  v_is_pool_seller boolean;
  v_pool_qty       integer;
  v_pool_qty_state integer;
  v_pool_avg       bigint;
  v_pool_total     bigint;
  -- NEW: plan name snapshot for sale_plan_lines
  v_plan_name      text;
  -- END NEW
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

  if (p_lines is null or jsonb_array_length(p_lines) = 0)
     and (p_service_lines is null or jsonb_array_length(p_service_lines) = 0)
     and (p_plan_lines is null or jsonb_array_length(p_plan_lines) = 0) then
    raise exception 'a sale must have at least one product, service, or plan line';
  end if;

  if p_payment_method is not null and
     p_payment_method not in ('cash', 'pos', 'bank_transfer', 'cheque', 'other') then
    raise exception 'invalid payment method';
  end if;

  if p_payment_status is null or p_payment_status not in ('paid', 'unpaid') then
    raise exception 'payment_status must be paid or unpaid';
  end if;

  if jsonb_array_length(coalesce(p_plan_lines, '[]')) > 0 and p_client_id is null then
    raise exception 'a client is required to sell a plan';
  end if;

  select coalesce(costing_method, 'weighted') into v_org_costing_method
    from public.organisations
   where id = v_org_id;

  select exists(
    select 1
      from public.memberships
     where user_id    = v_user_id
       and deleted_at is null
       and (
         (role = 'owner' and organisation_id = v_org_id)
         or (role = 'admin' and branch_id = p_branch_id)
       )
  ) into v_is_pool_seller;

  insert into public.sales (
    organisation_id, branch_id, seller_user_id,
    customer_name, customer_phone, sold_on, total_cents, note,
    payment_method, payment_status, amount_paid_cents, client_id, created_by
  ) values (
    v_org_id, p_branch_id, v_user_id,
    nullif(trim(p_customer_name),  ''),
    nullif(trim(p_customer_phone), ''),
    coalesce(p_sold_on, current_date),
    0,
    nullif(trim(p_note), ''),
    p_payment_method, p_payment_status, 0, p_client_id, v_user_id
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

    if v_is_pool_seller then

      -- ════════════════════════════════════════════════════════════════════════
      -- POOL PATH — owner / admin sell from branch pool (product_stock).
      -- Byte-identical to app_0069.
      -- ════════════════════════════════════════════════════════════════════════

      select coalesce(quantity, 0) into v_pool_qty
        from public.product_stock
       where branch_id  = p_branch_id
         and product_id = v_product_id
       for update;

      if coalesce(v_pool_qty, 0) < v_qty then
        raise exception
          'insufficient pool stock for product % (pool: %, needed: %)',
          v_product_id, coalesce(v_pool_qty, 0), v_qty;
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
        reason, reference_type, reference_id, created_by
      ) values (
        v_org_id, p_branch_id, v_product_id, -v_qty,
        'sale', 'sale', v_sale_id, v_user_id
      );

      update public.product_stock
         set quantity   = quantity - v_qty,
             updated_at = now()
       where branch_id  = p_branch_id
         and product_id = v_product_id;

      select quantity, avg_cost_cents, total_cost_cents
        into v_pool_qty_state, v_pool_avg, v_pool_total
        from public.product_cost_state
       where branch_id      = p_branch_id
         and product_id     = v_product_id
         and holder_user_id is null
       for update;

      v_pool_qty_state := coalesce(v_pool_qty_state, 0);

      if v_org_costing_method = 'fifo' then
        select
          case when bool_and(d.unit_cost_cents is not null)
                 then sum(d.qty_consumed::bigint * d.unit_cost_cents)
               else null end,
          coalesce(bool_and(d.unit_cost_cents is not null), false)
        into v_cogs_cents, v_cost_known
        from public.drain_fifo_layers(
          v_org_id, p_branch_id, null, v_product_id, v_qty
        ) d;
      else
        if v_pool_avg is not null then
          v_cogs_cents := v_qty::bigint * v_pool_avg;
          v_cost_known := true;
        else
          v_cogs_cents := null;
          v_cost_known := false;
        end if;
      end if;

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

      v_new_qty   := greatest(v_pool_qty_state - v_qty, 0);
      v_new_total := case
                       when v_new_qty = 0     then 0
                       when v_pool_avg is null then null
                       else greatest(
                             coalesce(v_pool_total, 0) - (v_qty::bigint * v_pool_avg),
                             0
                           )
                     end;

      insert into public.product_cost_state (
        organisation_id, branch_id, holder_user_id, product_id,
        quantity, avg_cost_cents, total_cost_cents
      ) values (
        v_org_id, p_branch_id, null, v_product_id,
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

      if v_org_costing_method <> 'fifo' then
        perform public.drain_fifo_layers(
          v_org_id, p_branch_id, null, v_product_id, v_qty
        );
      end if;

    else

      -- ════════════════════════════════════════════════════════════════════════
      -- HOLDING PATH — sales role sells from personal holding (staff_holdings).
      -- Byte-identical to app_0069.
      -- ════════════════════════════════════════════════════════════════════════

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

      select quantity, avg_cost_cents, total_cost_cents
        into v_holder_qty, v_holder_avg, v_holder_total
        from public.product_cost_state
       where branch_id      = p_branch_id
         and holder_user_id = v_user_id
         and product_id     = v_product_id
       for update;

      v_holder_qty := coalesce(v_holder_qty, 0);

      if v_org_costing_method = 'fifo' then
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
        if v_holder_avg is not null then
          v_cogs_cents := v_qty * v_holder_avg;
          v_cost_known := true;
        else
          v_cogs_cents := null;
          v_cost_known := false;
        end if;
      end if;

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

      if v_org_costing_method <> 'fifo' then
        perform public.drain_fifo_layers(
          v_org_id, p_branch_id, v_user_id, v_product_id, v_qty
        );
      end if;

    end if; -- v_is_pool_seller

  end loop;

  -- ── service lines loop (byte-identical to app_0069) ───────────────────────
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

  -- ── plan lines loop ───────────────────────────────────────────────────────
  -- No stock movement, no COGS. Inserts client_plans + sale_plan_lines.
  -- p_client_id is guaranteed non-null here (guard above fires first).
  for v_plan_line in select * from jsonb_array_elements(coalesce(p_plan_lines, '[]'))
  loop
    v_plan_id    := (v_plan_line->>'plan_id')::uuid;
    v_price_paid := (v_plan_line->>'price_paid_cents')::bigint;

    if v_price_paid is null or v_price_paid < 0 then
      raise exception 'plan line price must be 0 or greater';
    end if;

    if not exists (
      select 1
        from public.plans
       where id              = v_plan_id
         and organisation_id = v_org_id
         and is_active       = true
         and deleted_at      is null
    ) then
      raise exception 'plan not found or inactive';
    end if;

    select coalesce(sum(session_count), 0) into v_sessions_total
      from public.plan_lines
     where plan_id = v_plan_id;

    if v_sessions_total = 0 then
      raise exception 'plan has no sessions configured';
    end if;

    insert into public.client_plans (
      organisation_id, client_id, plan_id,
      sessions_total, sessions_used, price_paid_cents,
      purchased_on, created_by
    ) values (
      v_org_id, p_client_id, v_plan_id,
      v_sessions_total, 0, v_price_paid,
      coalesce(p_sold_on, current_date), v_user_id
    );

    -- NEW: snapshot plan name and write the invoice-visible sale_plan_lines row.
    -- Name read after the plan-exists guard above, so the row is guaranteed present.
    select name into v_plan_name
      from public.plans
     where id = v_plan_id;

    insert into public.sale_plan_lines (
      sale_id, plan_id, plan_name, sessions_total, price_paid_cents
    ) values (
      v_sale_id, v_plan_id, v_plan_name, v_sessions_total, v_price_paid
    );
    -- END NEW

    v_plan_total := v_plan_total + v_price_paid;
  end loop;

  -- ── VAT computation (byte-identical to app_0069) ──────────────────────────
  v_subtotal := v_total + v_svc_total + v_plan_total;
  v_vat      := round(v_subtotal * coalesce(p_vat_rate, 0) / 100.0);
  v_total    := v_subtotal + v_vat;

  update public.sales
     set subtotal_cents        = v_subtotal,
         vat_rate              = p_vat_rate,
         vat_cents             = v_vat,
         total_cents           = v_total,
         service_revenue_cents = v_svc_total,
         plan_revenue_cents    = v_plan_total,
         amount_paid_cents     = case
                                   when p_payment_status = 'paid' then v_total
                                   else 0
                                 end
   where id = v_sale_id;

  return v_sale_id;
end;
$$;

revoke all    on function public.record_sale(uuid, text, text, date, text, text, text, jsonb, numeric, jsonb, uuid, jsonb) from public;
grant execute on function public.record_sale(uuid, text, text, date, text, text, text, jsonb, numeric, jsonb, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
