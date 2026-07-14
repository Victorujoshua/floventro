-- ─────────────────────────────────────────────────────────────────────────────
-- app_0019_stock_adjustments.sql
--
-- Adds structured stock adjustments to the ledger system.
--
-- PRE-APPLY CHECK (run this first; must return 0):
--   select count(*) from public.stock_ledger where reason = 'adjustment';
-- If > 0 the consistency constraint below will fail on existing rows.
--
-- Depends on: app_0010_stock (stock_ledger, product_stock)
--             app_0009_vendors_rls (user_vendor_write_branch_ids helper)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add adjustment_reason sub-column to stock_ledger ───────────────────────

alter table public.stock_ledger
  add column adjustment_reason text
  check (adjustment_reason is null or adjustment_reason in (
    'opening_stock', 'stock_count', 'damaged', 'expired', 'lost', 'correction'
  ));

-- Enforce that adjustment_reason is set if and only if reason = 'adjustment'.
-- This keeps the column semantically meaningful and prevents accidental misuse.
alter table public.stock_ledger
  add constraint stock_ledger_adjustment_reason_consistency
  check (
    (reason = 'adjustment' and adjustment_reason is not null)
    or (reason <> 'adjustment' and adjustment_reason is null)
  );

-- ── 2. adjust_stock RPC ───────────────────────────────────────────────────────
--
-- Applies a stock adjustment for one product in one branch. Runs as
-- security definer because it writes stock_ledger and product_stock, which
-- have no user-facing write policies.
--
-- The caller must supply EITHER p_new_quantity (Set-to mode: the desired
-- resulting quantity) OR p_delta (Adjust-by mode: the signed change).
-- Supplying both or neither raises an exception.
--
-- Five credibility guards (all mandatory — see task spec):
--   1. adjustment_reason required and must be a known enum value.
--   2. Caller must be owner or inventory member of the target branch.
--   3. stock_ledger entry + product_stock update are written atomically.
--      product_stock is row-locked with FOR UPDATE before reading, which
--      serialises concurrent adjustments on the same product (same race
--      fix applied in app_0017 for review_stock_request).
--   4. A note is required for any decrease, and for an increase of 100+.
--   5. opening_stock is only valid for a product with no prior ledger
--      history in this branch AND zero current stock.
--
-- Returns the resulting quantity after the adjustment.

create or replace function public.adjust_stock(
  p_branch_id         uuid,
  p_product_id        uuid,
  p_new_quantity      integer,   -- desired resulting quantity (Set-to mode); null for Adjust-by
  p_delta             integer,   -- signed change (Adjust-by mode); null for Set-to
  p_adjustment_reason text,      -- opening_stock | stock_count | damaged | expired | lost | correction
  p_note              text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_org_id     uuid;
  v_current    integer;
  v_delta      integer;
  v_new        integer;
  v_has_history boolean;
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

  -- ── Product must belong to this org ──────────────────────────────────────────
  if not exists (
    select 1 from public.products
     where id = p_product_id
       and organisation_id = v_org_id
       and deleted_at is null
  ) then
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
    nullif(trim(p_note), ''),
    v_user_id
  );

  insert into public.product_stock (organisation_id, branch_id, product_id, quantity)
  values (v_org_id, p_branch_id, p_product_id, v_new)
  on conflict (branch_id, product_id)
  do update set quantity = v_new, updated_at = now();

  return v_new;
end;
$$;

revoke all  on function public.adjust_stock(uuid, uuid, integer, integer, text, text) from public;
grant execute on function public.adjust_stock(uuid, uuid, integer, integer, text, text) to authenticated;
