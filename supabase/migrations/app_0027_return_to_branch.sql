-- ─────────────────────────────────────────────────────────────────────────────
-- app_0027_return_to_branch.sql
--
-- Adds a return_to_branch RPC: a staffer returns stock from their personal
-- holding back to the branch. This is the exact mirror of the issue-to-holding
-- flow in app_0023.
--
-- Two-leg ledger pattern (mirrors app_0023 in reverse):
--
--   app_0023 (issue):              app_0027 (return, mirror):
--   ─────────────────────────────  ────────────────────────────────────────────
--   Branch leg  reason='request_fulfilment'  holder=NULL   qty= -n (leaves branch)
--   Holding leg reason='issue_to_holding'    holder=uid    qty= +n (enters holding)
--
--   Holding leg reason='return_to_branch'    holder=uid    qty= -n (leaves holding)
--   Branch leg  reason='return_receipt'      holder=NULL   qty= +n (enters branch)
--
-- Constraint analysis:
--   'return_to_branch' ∈ ('issue_to_holding','return_to_branch','sale','usage')
--     → holder_user_id IS NOT NULL required → holder=uid satisfies this ✓
--   'return_receipt' ∉ the constrained list
--     → holder_user_id IS NULL required → holder=NULL satisfies this ✓
--
-- Because 'return_receipt' is a new value, the stock_ledger reason CHECK
-- constraint must be extended (STEP 1) before the RPC is created (STEP 2).
--
-- No new tables. No data backfill.
--
-- Depends on: app_0021_ledger_holder (reason CHECK + holder_consistency)
--             app_0022_staff_holdings (staff_holdings table)
--             app_0023_extend_review_request (issue-to-holding pattern reference)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── STEP 1: Extend the reason CHECK constraint to include 'return_receipt' ───
--
-- 'return_receipt' is the branch-receiving leg of a holding return.
-- It is NOT added to stock_ledger_holder_consistency — the constraint already
-- mandates holder_user_id IS NULL for any reason outside the constrained list,
-- which is exactly what the branch leg requires.
--
-- Full list = app_0021's 10 values + 'return_receipt'. All 10 original values
-- are preserved verbatim below.

alter table public.stock_ledger
  drop constraint stock_ledger_reason_check;

alter table public.stock_ledger
  add constraint stock_ledger_reason_check
  check (reason in (
    'vendor_invoice',
    'sale',
    'usage',
    'transfer_in',
    'transfer_out',
    'request_fulfilment',
    'adjustment',
    'reversal',
    'issue_to_holding',
    'return_to_branch',
    'return_receipt'        -- new: branch receives stock returned from a holding
  ));


-- ── STEP 2: return_to_branch RPC ─────────────────────────────────────────────
--
-- Parameters:
--   p_branch_id    — which branch the holding belongs to
--   p_product_id   — which product to return
--   p_quantity     — how many units to return (must be > 0, ≤ held quantity)
--   p_note         — optional reason / comment for the return
--
-- Returns: void (the operation is either fully committed or fully rolled back)
--
-- Access: any authenticated org member who has a holding in this branch.
--         The holding guard enforces that they actually hold the product.

create or replace function public.return_to_branch(
  p_branch_id  uuid,
  p_product_id uuid,
  p_quantity   integer,
  p_note       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid    := auth.uid();
  v_org_id  uuid;
  v_held    integer;
begin
  -- ── Auth guard ───────────────────────────────────────────────────────────────
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- ── Validate quantity ────────────────────────────────────────────────────────
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than 0';
  end if;

  -- ── Resolve and validate branch ───────────────────────────────────────────────
  select organisation_id into v_org_id
    from public.branches
   where id = p_branch_id
     and deleted_at is null;

  if v_org_id is null then
    raise exception 'branch not found';
  end if;

  -- ── Membership gate ───────────────────────────────────────────────────────────
  -- The caller must be a member of this branch. Holding sufficiency is checked
  -- by the holding guard below, not by role — any member may return stock.
  if p_branch_id not in (select public.user_vendor_read_branch_ids()) then
    raise exception 'not authorised to return stock in this branch';
  end if;

  -- ── Product must belong to this org ──────────────────────────────────────────
  if not exists (
    select 1
      from public.products
     where id              = p_product_id
       and organisation_id = v_org_id
       and deleted_at      is null
  ) then
    raise exception 'product not found in this organisation';
  end if;

  -- ── HOLDING GUARD ─────────────────────────────────────────────────────────────
  -- FOR UPDATE locks this (branch, holder, product) row for the transaction.
  -- A concurrent return or sale of the same product by the same user blocks here,
  -- then re-reads the decremented quantity — correctly failing if holding ran out.
  --
  -- If the user has no row for this product (never held it), the SELECT INTO sets
  -- v_held to NULL; coalesce(v_held, 0) = 0, which is < any positive p_quantity —
  -- the guard raises immediately.
  select coalesce(quantity, 0) into v_held
    from public.staff_holdings
   where branch_id      = p_branch_id
     and holder_user_id = v_user_id
     and product_id     = p_product_id
   for update;

  if coalesce(v_held, 0) < p_quantity then
    raise exception
      'insufficient holding for product % (holding: %, returning: %)',
      p_product_id, coalesce(v_held, 0), p_quantity;
  end if;

  -- ── Ledger: holding leg — stock leaves the staffer's holding ─────────────────
  -- reason = 'return_to_branch', holder_user_id = v_user_id.
  -- 'return_to_branch' IS in the holder_consistency constrained list →
  -- holder_user_id IS NOT NULL is required → v_user_id satisfies this.
  insert into public.stock_ledger (
    organisation_id,
    branch_id,
    product_id,
    quantity_delta,
    reason,
    reference_type,
    reference_id,
    holder_user_id,
    note,
    created_by
  ) values (
    v_org_id,
    p_branch_id,
    p_product_id,
    -p_quantity,           -- stock LEAVES the holder
    'return_to_branch',
    'staff_holding',
    v_user_id,             -- reference the returning user's identity (no separate entity)
    v_user_id,             -- the staffer IS the holder
    nullif(trim(p_note), ''),
    v_user_id
  );

  -- ── Decrement staff_holdings ──────────────────────────────────────────────────
  -- The holding guard above confirmed quantity >= p_quantity.
  update public.staff_holdings
     set quantity   = quantity - p_quantity,
         updated_at = now()
   where branch_id      = p_branch_id
     and holder_user_id = v_user_id
     and product_id     = p_product_id;

  -- ── Ledger: branch leg — stock arrives back at the branch ────────────────────
  -- reason = 'return_receipt', holder_user_id = NULL.
  -- 'return_receipt' is NOT in the holder_consistency constrained list →
  -- holder_user_id IS NULL is required → NULL satisfies this.
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
    v_org_id,
    p_branch_id,
    p_product_id,
    p_quantity,            -- stock ENTERS the branch
    'return_receipt',
    'staff_holding',
    v_user_id,
    v_user_id
  );

  -- ── Increment product_stock ───────────────────────────────────────────────────
  -- Upsert: if no product_stock row exists for this branch+product (shouldn't
  -- happen in practice, but safe), create one rather than fail silently.
  insert into public.product_stock (
    organisation_id,
    branch_id,
    product_id,
    quantity
  ) values (
    v_org_id,
    p_branch_id,
    p_product_id,
    p_quantity
  )
  on conflict (branch_id, product_id)
  do update
    set quantity   = product_stock.quantity + excluded.quantity,
        updated_at = now();

end;
$$;

revoke all    on function public.return_to_branch(uuid, uuid, integer, text) from public;
grant execute on function public.return_to_branch(uuid, uuid, integer, text) to authenticated;
