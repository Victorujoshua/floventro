-- ─────────────────────────────────────────────────────────────────────────────
-- app_0031_sales_payment.sql
--
-- Adds payment tracking to sales: payment_status + amount_paid_cents on the
-- sales header, a sale_payments audit log, and a record_sale_payment RPC
-- (mirrors record_vendor_payment — money IN).
--
-- record_sale gains one new parameter (p_payment_status) — arity changes from
--   (uuid,text,text,date,text,text,jsonb) → (uuid,text,text,date,text,text,text,jsonb)
-- so the old signature must be dropped and the function recreated.
--
-- Diff vs app_0025 record_sale body — ONLY four additions (marked [NEW-x]):
--   [NEW-a]  p_payment_status text param added (after p_payment_method)
--   [NEW-b]  Validation: p_payment_status must be 'paid' or 'unpaid'
--   [NEW-c]  sales INSERT: + payment_status + amount_paid_cents columns/values
--   [NEW-d]  Final UPDATE: + amount_paid_cents derived from payment_status
-- Every other line is byte-identical to app_0025.
--
-- Existing sales default to payment_status='paid', amount_paid_cents=0.
-- Status is correct (all past sales were point-of-sale, assumed collected).
-- amount_paid_cents is not backfilled — status alone drives display.
--
-- Depends on: app_0024_sales, app_0025_sale_payment_method
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Schema: add payment columns to sales ───────────────────────────────────

alter table public.sales
  add column payment_status    text   not null default 'paid'
  check (payment_status in ('paid', 'unpaid', 'partial'));

alter table public.sales
  add column amount_paid_cents bigint not null default 0
  check (amount_paid_cents >= 0);


-- ── 2. sale_payments table ────────────────────────────────────────────────────
--
-- Append-only audit log of payment receipts against sales (money IN).
-- Mirrors vendor_payments (app_0020) — same immutability, same RPC-only writes.
-- method is nullable (sale may be noted without a specific method).

create table public.sale_payments (
  id               uuid        primary key default gen_random_uuid(),
  organisation_id  uuid        not null references public.organisations(id) on delete restrict,
  branch_id        uuid        not null references public.branches(id)      on delete restrict,
  sale_id          uuid        not null references public.sales(id)         on delete restrict,
  amount_cents     bigint      not null check (amount_cents > 0),
  paid_on          date        not null default current_date,
  method           text        check (method is null or method in ('cash','pos','bank_transfer','cheque','other')),
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid        references auth.users(id)
);

create index sale_payments_sale_idx
  on public.sale_payments (sale_id);

create index sale_payments_branch_date_idx
  on public.sale_payments (branch_id, paid_on);

alter table public.sale_payments enable row level security;

create policy "read sale_payments in own branch"
  on public.sale_payments
  for select
  using (
    branch_id in (select public.user_vendor_read_branch_ids())
  );
-- No INSERT / UPDATE / DELETE user policy — RPC-only writes.


-- ── 3. Updated record_sale (drop + recreate for arity change) ─────────────────

drop function if exists public.record_sale(uuid, text, text, date, text, text, jsonb);

create or replace function public.record_sale(
  p_branch_id      uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_sold_on        date,
  p_note           text,
  p_payment_method text,
  p_payment_status text,            --[NEW-a] 'paid' or 'unpaid'; validated below
  p_lines          jsonb
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
  if p_branch_id not in (select public.user_vendor_read_branch_ids()) then
    raise exception 'not authorised to record sales in this branch';
  end if;

  -- ── Lines required ────────────────────────────────────────────────────────────
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale must have at least one line';
  end if;

  -- ── Payment method validation ─────────────────────────────────────────────────
  if p_payment_method is not null and
     p_payment_method not in ('cash', 'pos', 'bank_transfer', 'cheque', 'other') then
    raise exception 'invalid payment method';
  end if;

  --[NEW-b] ── Payment status validation ─────────────────────────────────────────
  -- 'partial' is only reachable via record_sale_payment after the fact.
  if p_payment_status is null or p_payment_status not in ('paid', 'unpaid') then
    raise exception 'payment_status must be paid or unpaid';
  end if;

  -- ── Insert sale header (total + amount_paid stamped after lines) ──────────────
  insert into public.sales (
    organisation_id,
    branch_id,
    seller_user_id,
    customer_name,
    customer_phone,
    sold_on,
    total_cents,
    note,
    payment_method,
    payment_status,                  --[NEW-c]
    amount_paid_cents,               --[NEW-c] 0 here; real amount stamped after loop
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
    p_payment_method,
    p_payment_status,                --[NEW-c]
    0,                               --[NEW-c]
    v_user_id
  )
  returning id into v_sale_id;

  -- ── Process each line ─────────────────────────────────────────────────────────
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
      -v_qty,
      'sale',
      'sale',
      v_sale_id,
      v_user_id,
      v_user_id
    );

    update public.staff_holdings
       set quantity   = quantity - v_qty,
           updated_at = now()
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id;

  end loop;

  -- ── Stamp final totals ────────────────────────────────────────────────────────
  update public.sales
     set total_cents       = v_total,
         amount_paid_cents = case                                   --[NEW-d]
                               when p_payment_status = 'paid' then v_total
                               else 0
                             end
   where id = v_sale_id;

  return v_sale_id;
end;
$$;

revoke all    on function public.record_sale(uuid, text, text, date, text, text, text, jsonb) from public;
grant execute on function public.record_sale(uuid, text, text, date, text, text, text, jsonb) to authenticated;


-- ── 4. record_sale_payment RPC ────────────────────────────────────────────────
--
-- Records a payment receipt against a sale (money IN).
-- Mirrors record_vendor_payment (app_0020) — same guard sequence.
--
-- Auth: owner/inventory write-access to the sale's branch.
--   The seller records the sale; management confirms funds were collected.
--   In single-person branches the seller IS the owner — no friction.
--
-- Returns the new payment_status string ('paid' | 'partial' | 'unpaid').

create or replace function public.record_sale_payment(
  p_sale_id      uuid,
  p_amount_cents bigint,
  p_paid_on      date,
  p_method       text,
  p_note         text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_sale        sales%rowtype;
  v_outstanding bigint;
  v_new_paid    bigint;
  v_status      text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- Lock the sale row — serialises concurrent payments on the same sale.
  select * into v_sale
    from public.sales
   where id = p_sale_id
   for update;

  if v_sale.id is null then
    raise exception 'sale not found';
  end if;

  -- Auth: owner or inventory write-access to the sale's branch.
  if v_sale.branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to record payments in this branch';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'payment amount must be greater than zero';
  end if;

  -- Overpayment guard
  v_outstanding := v_sale.total_cents - v_sale.amount_paid_cents;

  if v_outstanding <= 0 then
    raise exception 'this sale is already fully paid';
  end if;

  if p_amount_cents > v_outstanding then
    raise exception 'payment exceeds the outstanding balance (outstanding: %, attempted: %)',
      v_outstanding, p_amount_cents;
  end if;

  -- Append to audit log
  insert into public.sale_payments (
    organisation_id, branch_id, sale_id,
    amount_cents, paid_on, method, note, created_by
  ) values (
    v_sale.organisation_id, v_sale.branch_id, p_sale_id,
    p_amount_cents,
    coalesce(p_paid_on, current_date),
    p_method,
    nullif(trim(p_note), ''),
    v_user_id
  );

  -- Update cached total; derive status from arithmetic — never set directly
  v_new_paid := v_sale.amount_paid_cents + p_amount_cents;

  if v_new_paid >= v_sale.total_cents then
    v_status := 'paid';
  elsif v_new_paid > 0 then
    v_status := 'partial';
  else
    v_status := 'unpaid';
  end if;

  update public.sales
     set amount_paid_cents = v_new_paid,
         payment_status    = v_status
   where id = p_sale_id;

  return v_status;
end;
$$;

revoke all    on function public.record_sale_payment(uuid, bigint, date, text, text) from public;
grant execute on function public.record_sale_payment(uuid, bigint, date, text, text) to authenticated;
