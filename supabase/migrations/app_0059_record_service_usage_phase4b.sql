-- ─────────────────────────────────────────────────────────────────────────────
-- app_0059_record_service_usage_phase4b.sql
--
-- Phase 4b: extend record_service_usage from 10 → 12 params.
--
-- Apply this file IN ISOLATION in a fresh SQL editor tab (no ALTER, no NOTIFY).
-- After confirming all 5 markers below are live, run notify pgrst separately.
--
-- New params (both default null — fully backwards-compatible):
--   p_client_plan_id  uuid  — subscription to draw down
--   p_client_id       uuid  — FK to clients table
--
-- New behaviour when p_client_plan_id IS NOT NULL:
--   1. SELECT sessions_used/total/price_paid FROM client_plans FOR UPDATE
--   2. Guard: sessions_used >= sessions_total → raise 'plan exhausted'
--   3. v_session_revenue := price_paid_cents / sessions_total  (integer div)
--   4. UPDATE client_plans SET sessions_used = sessions_used + 1
--   5. service_records INSERT also receives client_id, client_plan_id,
--      session_revenue_cents (all NULL when no plan supplied)
--
-- Cost block (product_cost_state, drain_fifo_layers, cogs_allocations,
-- staff_holdings, FIFO/weighted branch) is BYTE-IDENTICAL to app_0056.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.record_service_usage(uuid, uuid, text, text, date, bigint, text, jsonb, text, text);

create or replace function public.record_service_usage(
  p_branch_id         uuid,
  p_service_type_id   uuid,
  p_customer_name     text,
  p_customer_phone    text,
  p_performed_on      date,
  p_service_fee_cents bigint,
  p_note              text,
  p_lines             jsonb,
  p_member_id         text default null,
  p_client_email      text default null,
  p_client_plan_id    uuid default null,
  p_client_id         uuid default null
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
  -- costing accumulators (unchanged from app_0035)
  v_org_costing_method text;
  v_consumption_id     uuid;
  v_holder_qty         integer;
  v_holder_avg         bigint;
  v_holder_total       bigint;
  v_cogs_cents         bigint;
  v_cost_known         boolean;
  v_new_qty            integer;
  v_new_total          bigint;
  -- plan-session accumulators (Phase 4b)
  v_plan_sessions_used  integer;
  v_plan_sessions_total integer;
  v_plan_price_paid     bigint;
  v_session_revenue     bigint;
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

  select coalesce(costing_method, 'weighted') into v_org_costing_method
    from public.organisations
   where id = v_org_id;

  -- ── Phase 4b: plan session gate ───────────────────────────────────────────
  if p_client_plan_id is not null then
    select sessions_used, sessions_total, price_paid_cents
      into v_plan_sessions_used, v_plan_sessions_total, v_plan_price_paid
      from public.client_plans
     where id = p_client_plan_id
     for update;

    if not found then
      raise exception 'client plan not found';
    end if;

    if v_plan_sessions_used >= v_plan_sessions_total then
      raise exception 'plan exhausted';
    end if;

    v_session_revenue := v_plan_price_paid / v_plan_sessions_total;

    update public.client_plans
       set sessions_used = sessions_used + 1
     where id = p_client_plan_id;
  end if;
  -- ── END Phase 4b ──────────────────────────────────────────────────────────

  -- ── ADDITIVE CHANGE: member_id and client_email columns added to INSERT ───────
  insert into public.service_records (
    organisation_id, branch_id, service_type_id, performed_by,
    customer_name, customer_phone, performed_on,
    service_fee_cents, note, member_id, client_email,
    client_id, client_plan_id, session_revenue_cents, created_by
  ) values (
    v_org_id, p_branch_id, p_service_type_id, v_user_id,
    nullif(trim(p_customer_name),  ''),
    nullif(trim(p_customer_phone), ''),
    coalesce(p_performed_on, current_date),
    p_service_fee_cents,
    nullif(trim(p_note), ''),
    nullif(trim(p_member_id),    ''),
    nullif(trim(p_client_email), ''),
    p_client_id,
    p_client_plan_id,
    v_session_revenue,
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

    -- FOR UPDATE on staff_holdings. Cost-state + cost_layers locks follow below.
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

    -- ── common: lock holder product_cost_state ────────────────────────────────
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
      -- FIFO: drain holder cost_layers; aggregate COGS across drained lots.
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
      -- WEIGHTED (default): COGS = qty × holder_avg.
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
      'service_consumption', v_consumption_id,
      v_qty, v_cogs_cents, v_cost_known,
      case when v_org_costing_method = 'fifo' then 'fifo' else 'weighted' end
    );

    -- ── common: decrement holder product_cost_state ───────────────────────────
    -- Always uses holder_avg × qty — see record_sale comment for rationale.
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
    if v_org_costing_method <> 'fifo' then
      perform public.drain_fifo_layers(
        v_org_id, p_branch_id, v_user_id, v_product_id, v_qty
      );
    end if;
    -- ── END NEW ────────────────────────────────────────────────────────────────

  end loop;

  return v_record_id;
end;
$$;
