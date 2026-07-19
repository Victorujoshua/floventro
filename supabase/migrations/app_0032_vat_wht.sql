-- ─────────────────────────────────────────────────────────────────────────────
-- Block 0: backfill subtotal_cents nulls + NOT NULL constraint + consistency check
-- ─────────────────────────────────────────────────────────────────────────────

-- Fill any NULL subtotal_cents rows (safe — WHERE clause makes it a no-op if already done)
update public.vendor_invoices
   set subtotal_cents = total_cents
 where subtotal_cents is null;

-- Set NOT NULL only if the column is currently nullable
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'vendor_invoices'
       and column_name  = 'subtotal_cents'
       and is_nullable  = 'YES'
  ) then
    alter table public.vendor_invoices
      alter column subtotal_cents set not null;
  end if;
end;
$$;

-- Add consistency constraint only if it does not already exist
do $$
begin
  if not exists (
    select 1
      from information_schema.table_constraints
     where table_schema    = 'public'
       and table_name      = 'vendor_invoices'
       and constraint_name = 'vendor_invoices_total_consistency'
  ) then
    alter table public.vendor_invoices
      add constraint vendor_invoices_total_consistency
      check (total_cents = subtotal_cents + vat_cents);
  end if;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Block A: record_vendor_invoice — add p_vat_rate parameter
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.record_vendor_invoice(uuid, uuid, text, date, date, text, jsonb);

create or replace function public.record_vendor_invoice(
  p_branch_id      uuid,
  p_vendor_id      uuid,
  p_invoice_number text,
  p_invoice_date   date,
  p_due_date       date,
  p_note           text,
  p_lines          jsonb,  -- array of { product_id, quantity, unit_cost_cents }
  p_vat_rate       numeric default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_org_id      uuid;
  v_invoice_id  uuid;
  v_line        jsonb;
  v_product_id  uuid;
  v_quantity    integer;
  v_unit_cost   bigint;
  v_line_total  bigint;
  v_total       bigint := 0;
  v_subtotal    bigint;
  v_vat         bigint := 0;
  v_product_org uuid;
begin
  -- 1. Auth guard
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- 2. Resolve the org for this branch and verify caller can write to it.
  select organisation_id into v_org_id
  from branches
  where id = p_branch_id and deleted_at is null;

  if v_org_id is null then
    raise exception 'branch not found';
  end if;

  if p_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to write to this branch';
  end if;

  -- 3. Verify the vendor belongs to this branch.
  if not exists (
    select 1 from vendors
    where id = p_vendor_id and branch_id = p_branch_id and deleted_at is null
  ) then
    raise exception 'vendor not found in this branch';
  end if;

  -- 4. Validate at least one line is present.
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'invoice must have at least one line';
  end if;

  -- 5. Insert invoice header. subtotal_cents and total_cents start at 0; stamped after lines.
  insert into vendor_invoices (
    organisation_id, branch_id, vendor_id, invoice_number,
    invoice_date, due_date, subtotal_cents, total_cents, status, receipt_status, note, created_by
  ) values (
    v_org_id, p_branch_id, p_vendor_id, nullif(p_invoice_number, ''),
    coalesce(p_invoice_date, current_date), p_due_date, 0, 0, 'unpaid', 'pending', nullif(p_note, ''), v_user_id
  ) returning id into v_invoice_id;

  -- 6. Process each line: validate → insert line.
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_quantity   := (v_line->>'quantity')::integer;
    v_unit_cost  := (v_line->>'unit_cost_cents')::bigint;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'line quantity must be positive';
    end if;
    if v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'line unit cost must be non-negative';
    end if;

    -- Product must exist and belong to this org.
    select organisation_id into v_product_org
    from products
    where id = v_product_id and deleted_at is null;

    if v_product_org is null then
      raise exception 'product % not found', v_product_id;
    end if;
    if v_product_org <> v_org_id then
      raise exception 'product % does not belong to this organisation', v_product_id;
    end if;

    v_line_total := v_quantity * v_unit_cost;
    v_total      := v_total + v_line_total;

    -- unit_cost_cents is goods price — VAT never touches it.
    insert into vendor_invoice_lines (
      invoice_id, product_id, quantity, unit_cost_cents, line_total_cents
    ) values (
      v_invoice_id, v_product_id, v_quantity, v_unit_cost, v_line_total
    );

  end loop;

  -- 7. Compute VAT and stamp all money columns.
  v_subtotal := v_total;
  v_vat      := round(v_subtotal * coalesce(p_vat_rate, 0) / 100.0);
  v_total    := v_subtotal + v_vat;

  update vendor_invoices
     set subtotal_cents = v_subtotal,
         vat_rate       = p_vat_rate,
         vat_cents      = v_vat,
         total_cents    = v_total
   where id = v_invoice_id;

  return v_invoice_id;
end;
$$;

revoke all on function public.record_vendor_invoice(uuid, uuid, text, date, date, text, jsonb, numeric) from public;
grant execute on function public.record_vendor_invoice(uuid, uuid, text, date, date, text, jsonb, numeric) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- Block B: record_vendor_payment — add p_wht_rate parameter
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.record_vendor_payment(uuid, bigint, date, text, text, text);

create or replace function public.record_vendor_payment(
  p_invoice_id   uuid,
  p_amount_cents bigint,
  p_paid_on      date,
  p_method       text,
  p_reference    text,
  p_note         text,
  p_wht_rate     numeric default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_inv         vendor_invoices%rowtype;
  v_outstanding bigint;
  v_wht_cents   bigint;
  v_settlement  bigint;
  v_new_paid    bigint;
  v_status      text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- Lock the invoice row — serialises concurrent payments on the same invoice.
  select * into v_inv
    from public.vendor_invoices
   where id = p_invoice_id
     and deleted_at is null
   for update;

  if v_inv.id is null then
    raise exception 'invoice not found';
  end if;

  -- Authorisation: owner or inventory member of the invoice's branch.
  if v_inv.branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to record payments in this branch';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'payment amount must be greater than zero';
  end if;

  if p_method is null or p_method not in ('bank_transfer','cash','cheque','pos','other') then
    raise exception 'a valid payment method is required';
  end if;

  -- WHT base is the invoice PRE-VAT subtotal, not the total and not the payment amount.
  v_wht_cents  := round(v_inv.subtotal_cents * coalesce(p_wht_rate, 0) / 100.0);
  v_settlement := p_amount_cents + v_wht_cents;

  -- Overpayment guard — uses settlement (cash + WHT), not raw cash.
  v_outstanding := v_inv.total_cents - v_inv.amount_paid_cents;

  if v_outstanding <= 0 then
    raise exception 'this invoice is already fully paid';
  end if;

  if v_settlement > v_outstanding then
    raise exception 'payment (%) plus withholding tax (%) exceeds the outstanding balance (%)',
      p_amount_cents, v_wht_cents, v_outstanding;
  end if;

  -- amount_cents = cash only; wht_cents tracked separately.
  insert into public.vendor_payments (
    organisation_id, branch_id, vendor_id, invoice_id,
    amount_cents, wht_rate, wht_cents, paid_on, method, reference, note, created_by
  ) values (
    v_inv.organisation_id, v_inv.branch_id, v_inv.vendor_id, p_invoice_id,
    p_amount_cents,
    p_wht_rate,
    v_wht_cents,
    coalesce(p_paid_on, current_date),
    p_method,
    nullif(trim(p_reference), ''),
    nullif(trim(p_note), ''),
    v_user_id
  );

  -- Settlement = cash + WHT advances the paid total.
  v_new_paid := v_inv.amount_paid_cents + v_settlement;

  if v_new_paid <= 0 then
    v_status := 'unpaid';
  elsif v_new_paid < v_inv.total_cents then
    v_status := 'partial';
  else
    v_status := 'paid';
  end if;

  update public.vendor_invoices
     set amount_paid_cents = v_new_paid,
         status            = v_status
   where id = p_invoice_id;

  return v_status;
end;
$$;

revoke all    on function public.record_vendor_payment(uuid, bigint, date, text, text, text, numeric) from public;
grant execute on function public.record_vendor_payment(uuid, bigint, date, text, text, text, numeric) to authenticated;
