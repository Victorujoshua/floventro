-- ─────────────────────────────────────────────────────────────────────────────
-- app_0060_service_two_phase.sql
--
-- ADDITIVE: introduces two new RPC functions alongside the existing
-- record_service_usage, which is NOT modified or dropped.
--
-- Background: the current record_service_usage does booking + plan gate +
-- product consumption atomically in one call.  The two-phase design separates
-- these concerns so that:
--   Step 1 — create_service_session  : books the appointment, draws down the
--             plan subscription, and snapshots session revenue.  No products.
--   Step 2 — add_service_consumption : the practitioner enters the products
--             consumed during the session.  Drains stock + freezes COGS.
--
-- record_service_usage remains live and unmodified (one-shot path is still
-- callable).  The new functions are built from its body (app_0059).
--
-- Self-service model: performed_by = auth.uid() throughout.  The same user
-- who books (step 1) must add consumption (step 2) — their holdings drain.
--
-- Cost-engine provenance:
--   add_service_consumption's loop is copied from record_service_usage
--   (app_0059 lines 155-294) with exactly two mechanical substitutions:
--     v_record_id  → p_service_record_id   (the record id is a param, not local)
--     p_branch_id  → v_branch_id           (branch is resolved, not a param)
--   All other logic — lock order, FIFO/weighted branch, drain_fifo_layers,
--   cogs_allocations INSERT, product_cost_state ON CONFLICT — is verbatim.
--
-- Verification markers:
--   -- ►► COST ENGINE START (verify against record_service_usage loop)
--   -- ►► COST ENGINE END
--   Use these to diff the block against the live pg_get_functiondef output.
--
-- Depends on: app_0059_record_service_usage_phase4b (live function body)
--             app_0058_job_costing_columns           (session_revenue_cents col)
--             app_0057_job_costing_foundation        (client_plans, service_records.client_id)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. create_service_session
-- ║
-- ║ Step 1: books a service session — plan gate + revenue snapshot + header
-- ║ INSERT.  No products.  Returns the new service_record uuid.
-- ║
-- ║ Source: record_service_usage (app_0059) lines 68-153 (top segment only).
-- ║ Dropped: p_lines param, "must consume" guard, all cost vars, costing_method
-- ║          query, entire product loop.
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.create_service_session(
  p_branch_id         uuid,
  p_service_type_id   uuid,
  p_customer_name     text    default null,
  p_customer_phone    text    default null,
  p_performed_on      date    default null,
  p_service_fee_cents bigint  default null,
  p_note              text    default null,
  p_member_id         text    default null,
  p_client_email      text    default null,
  p_client_plan_id    uuid    default null,
  p_client_id         uuid    default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_org_id     uuid;
  v_record_id  uuid;
  -- plan-session accumulators (verbatim from record_service_usage Phase 4b block)
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

  if p_service_fee_cents is not null and p_service_fee_cents < 0 then
    raise exception 'service fee cannot be negative';
  end if;

  -- ── Plan session gate (verbatim from app_0059 lines 110-131) ─────────────
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
  -- ── END plan session gate ─────────────────────────────────────────────────

  -- v_session_revenue is null when no plan is linked — stored as null in the col.
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

  return v_record_id;
end;
$$;

revoke all    on function public.create_service_session(uuid, uuid, text, text, date, bigint, text, text, text, uuid, uuid) from public;
grant  execute on function public.create_service_session(uuid, uuid, text, text, date, bigint, text, text, text, uuid, uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. add_service_consumption
-- ║
-- ║ Step 2: enters the products used in an existing session.  Drains
-- ║ staff_holdings and freezes COGS — the full cost engine.
-- ║
-- ║ Auth: the caller (auth.uid()) must be the performed_by of the session.
-- ║ Self-service: the practitioner drains their own holdings.
-- ║
-- ║ Cost engine source: record_service_usage (app_0059) lines 155-294.
-- ║ Mechanical substitutions vs. source (everything else verbatim):
-- ║   v_record_id  → p_service_record_id
-- ║   p_branch_id  → v_branch_id          (resolved from service_records above)
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.add_service_consumption(
  p_service_record_id uuid,
  p_lines             jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_org_id       uuid;
  v_branch_id    uuid;
  v_performed_by uuid;
  v_line         jsonb;
  v_product_id   uuid;
  v_qty          integer;
  v_held         integer;
  -- costing accumulators (verbatim from record_service_usage declare block)
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

  select branch_id, organisation_id, performed_by
    into v_branch_id, v_org_id, v_performed_by
    from public.service_records
   where id = p_service_record_id;

  if not found then
    raise exception 'service record not found';
  end if;

  if v_performed_by <> v_user_id then
    raise exception 'not authorised to add consumption to this session';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'service usage must consume at least one product';
  end if;

  select coalesce(costing_method, 'weighted') into v_org_costing_method
    from public.organisations
   where id = v_org_id;

  -- ►► COST ENGINE START (verify against record_service_usage loop, app_0059 lines 155-294)
  -- Substitutions applied: v_record_id → p_service_record_id | p_branch_id → v_branch_id
  -- All other logic is verbatim.

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
     where branch_id      = v_branch_id
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
      p_service_record_id, v_product_id, v_qty
    )
    returning id into v_consumption_id;

    insert into public.stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, holder_user_id, created_by
    ) values (
      v_org_id, v_branch_id, v_product_id, -v_qty,
      'usage', 'service_record', p_service_record_id, v_user_id, v_user_id
    );

    update public.staff_holdings
       set quantity   = quantity - v_qty,
           updated_at = now()
     where branch_id      = v_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id;

    -- ── common: lock holder product_cost_state ────────────────────────────────
    select quantity, avg_cost_cents, total_cost_cents
      into v_holder_qty, v_holder_avg, v_holder_total
      from public.product_cost_state
     where branch_id      = v_branch_id
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
        v_org_id, v_branch_id, v_user_id, v_product_id, v_qty
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
      v_org_id, v_branch_id, v_product_id,
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
      v_org_id, v_branch_id, v_user_id, v_product_id,
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
        v_org_id, v_branch_id, v_user_id, v_product_id, v_qty
      );
    end if;
    -- ── END NEW ────────────────────────────────────────────────────────────────

  end loop;
  -- ►► COST ENGINE END

end;
$$;

revoke all    on function public.add_service_consumption(uuid, jsonb) from public;
grant  execute on function public.add_service_consumption(uuid, jsonb) to authenticated;


notify pgrst, 'reload schema';
