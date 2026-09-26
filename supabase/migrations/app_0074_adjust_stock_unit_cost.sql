-- ─────────────────────────────────────────────────────────────────────────────
-- app_0074_adjust_stock_unit_cost.sql
--
-- Closes the costing gap on the adjustment / opening-stock path.
--
-- Before: adjust_stock wrote stock_ledger + product_stock only. Units added this
-- way had no cost anywhere — product_cost_state.avg_cost_cents stayed NULL, no
-- cost layer was created, and every later sale of those units froze
-- cost_known = false into cogs_allocations.
--
-- After: adjust_stock takes an optional p_unit_cost_cents. For an INCREASE:
--   1. Cost = p_unit_cost_cents if given, else products.unit_cost_cents.
--   2. If a cost is resolved, the added units are costed exactly like a vendor
--      receipt (receive_invoice_stock):
--        - stock_ledger.unit_cost_cents records the cost,
--        - the pool product_cost_state is blended (weighted average; a bucket
--          already holding unknown-cost units stays unknown),
--        - fifo_add_layer creates a fresh pool layer (source 'adjustment',
--          source_ref_id = the stock_ledger row).
--   3. If no cost is resolved, behaviour is unchanged: no cost state, no layer.
--
-- Decreases are unchanged (p_unit_cost_cents is ignored for them).
--
-- Forward-only: no existing cost_layers, product_cost_state or
-- cogs_allocations rows are read-modified or backfilled by this migration.
--
-- Signature change: the old 6-arg function is dropped so PostgREST never sees
-- two overloads (a 6-named-arg call would otherwise be ambiguous).
--
-- Depends on: app_0019 (adjust_stock), app_0034 (product_cost_state),
--             app_0038 (fifo_add_layer)
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.adjust_stock(uuid, uuid, integer, integer, text, text);

create or replace function public.adjust_stock(
  p_branch_id         uuid,
  p_product_id        uuid,
  p_new_quantity      integer,   -- desired resulting quantity (Set-to mode); null for Adjust-by
  p_delta             integer,   -- signed change (Adjust-by mode); null for Set-to
  p_adjustment_reason text,      -- opening_stock | stock_count | damaged | expired | lost | correction
  p_note              text,
  p_unit_cost_cents   bigint default null  -- increases only; null = fall back to catalogue cost
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_org_id      uuid;
  v_current     integer;
  v_delta       integer;
  v_new         integer;
  v_has_history boolean;
  -- ── NEW (costing) ──────────────────────────────────────────────────────────
  v_catalog_cost bigint;
  v_unit_cost    bigint;
  v_ledger_id    uuid;
  v_pool_qty     integer;
  v_pool_avg     bigint;
  v_pool_total   bigint;
  v_new_qty      integer;
  v_new_total    bigint;
  v_new_avg      bigint;
begin
  -- ── 1. Auth guard ────────────────────────────────────────────────────────────
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- ── 2. Resolve org from branch ────────────────────────────────────────────────
  select organisation_id into v_org_id
    from public.branches
   where id = p_branch_id and deleted_at is null;

  if v_org_id is null then
    raise exception 'branch not found';
  end if;

  -- ── Guard 2: owner or inventory only ─────────────────────────────────────────
  if p_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to adjust stock in this branch';
  end if;

  -- ── Product must belong to this org (CHANGED: also reads catalogue cost) ─────
  select unit_cost_cents into v_catalog_cost
    from public.products
   where id = p_product_id
     and organisation_id = v_org_id
     and deleted_at is null;

  if not found then
    raise exception 'product not found in this organisation';
  end if;

  -- ── Guard 1: reason required and valid ────────────────────────────────────────
  if p_adjustment_reason is null or p_adjustment_reason not in
     ('opening_stock', 'stock_count', 'damaged', 'expired', 'lost', 'correction')
  then
    raise exception 'a valid adjustment reason is required';
  end if;

  -- ── Exactly one of p_new_quantity / p_delta must be provided ─────────────────
  if (p_new_quantity is null) = (p_delta is null) then
    raise exception 'provide either a new quantity or a delta, not both';
  end if;

  -- ── NEW: unit cost must be non-negative when given ────────────────────────────
  if p_unit_cost_cents is not null and p_unit_cost_cents < 0 then
    raise exception 'unit cost cannot be negative';
  end if;

  -- ── Guard 3 (first half): lock the stock row and read current quantity ────────
  -- FOR UPDATE serialises concurrent adjustments on the same (branch, product) row.
  -- If no row exists (first-ever stock for this product in this branch), SELECT INTO
  -- sets v_current to NULL; the coalesce below handles that.
  select coalesce(quantity, 0) into v_current
    from public.product_stock
   where branch_id  = p_branch_id
     and product_id = p_product_id
   for update;

  v_current := coalesce(v_current, 0);

  -- ── Compute delta and resulting quantity ──────────────────────────────────────
  if p_new_quantity is not null then
    if p_new_quantity < 0 then
      raise exception 'quantity cannot be negative';
    end if;
    v_new   := p_new_quantity;
    v_delta := v_new - v_current;
  else
    v_delta := p_delta;
    v_new   := v_current + v_delta;
    if v_new < 0 then
      raise exception
        'adjustment would make stock negative (on hand: %, change: %)',
        v_current, v_delta;
    end if;
  end if;

  if v_delta = 0 then
    raise exception 'no change — the quantity is already %', v_current;
  end if;

  -- ── Guard 4: note required for decreases and large increases (100+) ───────────
  if (v_delta < 0 or v_delta >= 100) and coalesce(trim(p_note), '') = '' then
    raise exception 'a note is required for this adjustment';
  end if;

  -- ── Guard 5: opening_stock only valid with no prior history ───────────────────
  if p_adjustment_reason = 'opening_stock' then
    select exists (
      select 1
        from public.stock_ledger
       where branch_id  = p_branch_id
         and product_id = p_product_id
    ) into v_has_history;

    if v_has_history or v_current <> 0 then
      raise exception
        'opening stock can only be set for a product with no prior stock history in this branch — use stock count or correction instead';
    end if;
  end if;

  -- ── NEW: resolve cost for increases (entered → catalogue → unknown) ───────────
  if v_delta > 0 then
    v_unit_cost := coalesce(p_unit_cost_cents, v_catalog_cost);
  else
    v_unit_cost := null;
  end if;

  -- ── Guard 3 (second half): write ledger + product_stock atomically ────────────
  insert into public.stock_ledger (
    organisation_id,
    branch_id,
    product_id,
    quantity_delta,
    reason,
    adjustment_reason,
    reference_type,
    reference_id,
    unit_cost_cents,
    note,
    created_by
  ) values (
    v_org_id,
    p_branch_id,
    p_product_id,
    v_delta,
    'adjustment',
    p_adjustment_reason,
    'adjustment',
    null,
    v_unit_cost,
    nullif(trim(p_note), ''),
    v_user_id
  )
  returning id into v_ledger_id;

  insert into public.product_stock (organisation_id, branch_id, product_id, quantity)
  values (v_org_id, p_branch_id, p_product_id, v_new)
  on conflict (branch_id, product_id)
  do update set quantity = v_new, updated_at = now();

  -- ── NEW: cost the added units (same as receive_invoice_stock) ─────────────────
  -- Only when an increase has a resolved cost. No cost → unchanged behaviour.
  if v_delta > 0 and v_unit_cost is not null then

    -- Weighted-average into branch pool. product_stock is already locked above,
    -- so the cost-state lock follows it (same lock order as receipts).
    select quantity, avg_cost_cents, total_cost_cents
      into v_pool_qty, v_pool_avg, v_pool_total
      from public.product_cost_state
     where branch_id      = p_branch_id
       and product_id     = p_product_id
       and holder_user_id is null
     for update;

    v_pool_qty := coalesce(v_pool_qty, 0);
    v_new_qty  := v_pool_qty + v_delta;

    if v_pool_qty > 0 and v_pool_avg is null then
      -- Tainted bucket: existing units have unknown cost. Cannot honestly blend
      -- known-cost arrivals with them. avg stays NULL; qty still grows.
      v_new_total := null;
      v_new_avg   := null;
    else
      v_new_total := coalesce(v_pool_total, 0) + (v_delta * v_unit_cost);
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

    -- FIFO: new stock entering the system → fresh global seq.
    perform public.fifo_add_layer(
      v_org_id,
      p_branch_id,
      null,              -- branch pool bucket
      p_product_id,
      v_delta,
      v_unit_cost,
      null,              -- new stock → assign fresh seq
      'adjustment',
      v_ledger_id
    );
  end if;
  -- ── END NEW ───────────────────────────────────────────────────────────────────

  return v_new;
end;
$$;

revoke all  on function public.adjust_stock(uuid, uuid, integer, integer, text, text, bigint) from public;
grant execute on function public.adjust_stock(uuid, uuid, integer, integer, text, text, bigint) to authenticated;
