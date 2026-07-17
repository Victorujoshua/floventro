-- ─────────────────────────────────────────────────────────────────────────────
-- app_0025_sale_payment_method.sql
--
-- Adds structured payment method to the sales table and updates record_sale
-- to accept and store it.
--
-- Diff vs app_0024_sales.sql — ONLY three additions (marked --[NEW]):
--   a. p_payment_method text in the function signature
--   b. payment method validation block before the lines loop
--   c. payment_method column + value in the sales INSERT
-- Every other line of record_sale is byte-identical to app_0024.
--
-- The old function must be dropped before recreating because adding a parameter
-- changes the arity — CREATE OR REPLACE cannot alter a parameter list in-place.
-- The old signature: record_sale(uuid, text, text, date, text, jsonb)
-- The new signature: record_sale(uuid, text, text, date, text, text, jsonb)
--
-- No backfill: the one existing test sale predates this column and will remain
-- with payment_method = NULL.
--
-- Depends on: app_0024_sales.sql
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Add payment_method column to sales ────────────────────────────────────
--
-- Nullable text with a check constraint — the same enum-as-text pattern used
-- by vendor_payments.method (app_0020). Existing rows keep NULL; future sales
-- will supply the method.

alter table public.sales
  add column payment_method text
  check (
    payment_method is null or
    payment_method in ('cash', 'pos', 'bank_transfer', 'cheque', 'other')
  );


-- ── 2. Drop old record_sale (arity change requires drop + recreate) ───────────

drop function if exists public.record_sale(uuid, text, text, date, text, jsonb);


-- ── 3. Recreate record_sale with p_payment_method ────────────────────────────
--
-- Body is identical to app_0024 except:
--   [NEW-a] p_payment_method text parameter added after p_note
--   [NEW-b] payment method validation block (before lines loop)
--   [NEW-c] payment_method column + p_payment_method value in the sales INSERT

create or replace function public.record_sale(
  p_branch_id      uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_sold_on        date,
  p_note           text,
  p_payment_method text,            --[NEW-a] nullable; validated below
  p_lines          jsonb             -- array of { product_id, quantity, unit_price_cents }
) returns uuid                      -- the new sale id
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
begin
  -- ── Auth guard ───────────────────────────────────────────────────────────────
  if v_user_id is null then
    raise exception 'not authenticated';
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
  -- Permission to sell is "do you hold enough" (checked per line below).
  -- This gate only verifies the caller is a member of this branch at all —
  -- a user from a different org cannot record a sale in this branch even if
  -- they somehow constructed a valid branch_id.
  if p_branch_id not in (select public.user_vendor_read_branch_ids()) then
    raise exception 'not authorised to record sales in this branch';
  end if;

  -- ── Lines required ────────────────────────────────────────────────────────────
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale must have at least one line';
  end if;

  --[NEW-b] ── Payment method validation ────────────────────────────────────────
  if p_payment_method is not null and
     p_payment_method not in ('cash', 'pos', 'bank_transfer', 'cheque', 'other') then
    raise exception 'invalid payment method';
  end if;

  -- ── Insert sale header (total filled after lines) ─────────────────────────────
  -- total_cents starts at 0 and is updated to the real sum at the end.
  insert into public.sales (
    organisation_id,
    branch_id,
    seller_user_id,
    customer_name,
    customer_phone,
    sold_on,
    total_cents,
    note,
    payment_method,                  --[NEW-c]
    created_by
  ) values (
    v_org_id,
    p_branch_id,
    v_user_id,
    nullif(trim(p_customer_name),  ''),
    nullif(trim(p_customer_phone), ''),
    coalesce(p_sold_on, current_date),
    0,
    nullif(trim(p_note), ''),
    p_payment_method,                --[NEW-c]
    v_user_id
  )
  returning id into v_sale_id;

  -- ── Process each line ─────────────────────────────────────────────────────────
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty        := (v_line->>'quantity')::integer;
    v_price      := (v_line->>'unit_price_cents')::bigint;

    -- ── Validate inputs ───────────────────────────────────────────────────────
    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be greater than 0';
    end if;

    if v_price is null or v_price < 0 then
      raise exception 'unit price must be 0 or greater';
    end if;

    -- ── Product must belong to this org ───────────────────────────────────────
    if not exists (
      select 1
        from public.products
       where id              = v_product_id
         and organisation_id = v_org_id
         and deleted_at      is null
    ) then
      raise exception 'product % not found in this organisation', v_product_id;
    end if;

    -- ── HOLDING GUARD ─────────────────────────────────────────────────────────
    -- FOR UPDATE locks this (branch, holder, product) row for the duration of
    -- the transaction. A concurrent sale of the same product by the same seller
    -- blocks here until this transaction commits, then re-reads the decremented
    -- quantity — correctly failing the guard if holding ran out.
    --
    -- If the seller has never held this product (no row exists), the SELECT INTO
    -- sets v_held to NULL. coalesce(v_held, 0) then evaluates to 0, which is
    -- less than any positive v_qty — the guard raises immediately.
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

    -- ── Insert sale line ──────────────────────────────────────────────────────
    -- unit_price_cents is captured here — it is not looked up from products.
    -- Historical price is preserved even if default_price_cents changes later.
    insert into public.sale_lines (
      sale_id,
      product_id,
      quantity,
      unit_price_cents,
      line_total_cents
    ) values (
      v_sale_id,
      v_product_id,
      v_qty,
      v_price,
      v_qty * v_price
    );

    v_total := v_total + (v_qty * v_price);

    -- ── Ledger: sale OUT of holding ───────────────────────────────────────────
    -- reason = 'sale', holder_user_id = v_user_id (the seller).
    -- The live stock_ledger_holder_consistency constraint REQUIRES holder_user_id
    -- to be non-null for reason = 'sale'. This insert always provides it.
    insert into public.stock_ledger (
      organisation_id,
      branch_id,
      product_id,
      quantity_delta,
      reason,
      reference_type,
      reference_id,
      holder_user_id,
      created_by
    ) values (
      v_org_id,
      p_branch_id,
      v_product_id,
      -v_qty,        -- stock leaves the holder's possession
      'sale',
      'sale',
      v_sale_id,
      v_user_id,     -- the seller IS the holder
      v_user_id
    );

    -- ── Decrement staff_holdings ──────────────────────────────────────────────
    -- The holding guard above confirmed quantity >= v_qty, so this cannot push
    -- quantity below zero. The check (quantity >= 0) on staff_holdings is a
    -- database-layer backstop for any future code path.
    update public.staff_holdings
       set quantity   = quantity - v_qty,
           updated_at = now()
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id;

  end loop;

  -- ── Update sale header with real total ────────────────────────────────────────
  update public.sales
     set total_cents = v_total
   where id = v_sale_id;

  return v_sale_id;
end;
$$;

revoke all    on function public.record_sale(uuid, text, text, date, text, text, jsonb) from public;
grant execute on function public.record_sale(uuid, text, text, date, text, text, jsonb) to authenticated;
