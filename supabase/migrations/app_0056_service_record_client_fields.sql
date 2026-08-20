-- ─────────────────────────────────────────────────────────────────────────────
-- app_0056_service_record_client_fields.sql
--
-- Adds member_id and client_email to service_records.
-- Updates record_service_usage RPC to accept and store both fields.
--
-- Base: app_0040_fifo_outflows.sql — the live record_service_usage body that
-- contains full FIFO/weighted cost tracking. CONFIRMED unchanged through app_0054.
-- The ENTIRE cost-tracking block is preserved byte-identical:
--   • product_cost_state FOR UPDATE lock
--   • FIFO branch: drain_fifo_layers → cogs_cents, cost_known
--   • Weighted branch: holder_avg × qty
--   • cogs_allocations INSERT (reference_type='service_consumption')
--   • product_cost_state decrement (holder_avg × qty formula)
--   • Weighted-mode PERFORM drain_fifo_layers sync
--
-- ADDITIVE changes only vs app_0040 body:
--   1. Signature: p_member_id text default null, p_client_email text default null
--      appended (positions 9 & 10). Old 8-param overload dropped first.
--   2. service_records INSERT: member_id, client_email columns added;
--      nullif(trim(...), '') applied to both new params.
--   3. NOTHING ELSE.
--
-- Why no NOT NULL on customer_name/customer_phone:
--   Requiredness is enforced at the app layer (Zod). Existing rows may have
--   NULL in those columns; a NOT NULL constraint would fail on them.
--
-- Depends on: app_0026_service_usage (service_records table)
--             app_0040_fifo_outflows  (live RPC body being extended)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. New columns on service_records ─────────────────────────────────────────

alter table public.service_records
  add column if not exists member_id    text,
  add column if not exists client_email text;


-- ── 2. Replace record_service_usage ───────────────────────────────────────────
--
-- PostgreSQL cannot CREATE OR REPLACE a function with a different parameter
-- list. Drop the old 8-param overload first, then create the new 10-param
-- version. The two new params carry DEFAULT NULL so callers omitting them
-- (e.g. PostgREST callers not yet passing the new fields) still resolve.

drop function if exists public.record_service_usage(uuid, uuid, text, text, date, bigint, text, jsonb);

create or replace function public.record_service_usage(
  p_branch_id         uuid,
  p_service_type_id   uuid,
  p_customer_name     text,
  p_customer_phone    text,
  p_performed_on      date,
  p_service_fee_cents bigint,
  p_note              text,
  p_lines             jsonb,
  p_member_id         text default null,   -- NEW: client membership / ID number
  p_client_email      text default null    -- NEW: client email address
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

  -- ── ADDITIVE CHANGE: member_id and client_email columns added to INSERT ───────
  insert into public.service_records (
    organisation_id, branch_id, service_type_id, performed_by,
    customer_name, customer_phone, performed_on,
    service_fee_cents, note, member_id, client_email, created_by
  ) values (
    v_org_id, p_branch_id, p_service_type_id, v_user_id,
    nullif(trim(p_customer_name),  ''),
    nullif(trim(p_customer_phone), ''),
    coalesce(p_performed_on, current_date),
    p_service_fee_cents,
    nullif(trim(p_note), ''),
    nullif(trim(p_member_id),    ''),
    nullif(trim(p_client_email), ''),
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

revoke all    on function public.record_service_usage(uuid, uuid, text, text, date, bigint, text, jsonb, text, text) from public;
grant execute on function public.record_service_usage(uuid, uuid, text, text, date, bigint, text, jsonb, text, text) to authenticated;


-- ── 3. Reload PostgREST schema cache ──────────────────────────────────────────

notify pgrst, 'reload schema';
