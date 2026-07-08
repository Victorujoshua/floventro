-- Migration: app_0012_record_vendor_invoice_rpc
-- Atomic recording of a vendor invoice: header + lines + ledger + stock + total.
-- Security definer because it writes stock_ledger and product_stock, which have
-- no user-facing write policies (writes reserved for this RPC).

create or replace function public.record_vendor_invoice(
  p_branch_id      uuid,
  p_vendor_id      uuid,
  p_invoice_number text,
  p_invoice_date   date,
  p_due_date       date,
  p_note           text,
  p_lines          jsonb   -- array of { product_id, quantity, unit_cost_cents }
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
  v_product_org uuid;
begin
  -- 1. Auth guard
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- 2. Resolve the org for this branch and verify caller can write to it.
  --    write access = owner of the org, or inventory member of the branch.
  select organisation_id into v_org_id
  from branches
  where id = p_branch_id and deleted_at is null;

  if v_org_id is null then
    raise exception 'branch not found';
  end if;

  if p_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to write to this branch';
  end if;

  -- 3. Verify the vendor belongs to this branch (not another branch or org).
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

  -- 5. Insert invoice header. total_cents starts at 0 and is set after lines are processed.
  insert into vendor_invoices (
    organisation_id, branch_id, vendor_id, invoice_number,
    invoice_date, due_date, total_cents, status, note, created_by
  ) values (
    v_org_id, p_branch_id, p_vendor_id, nullif(p_invoice_number, ''),
    coalesce(p_invoice_date, current_date), p_due_date, 0, 'unpaid', nullif(p_note, ''), v_user_id
  ) returning id into v_invoice_id;

  -- 6. Process each line: validate → insert line → append ledger → upsert stock.
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

    -- Product must exist and belong to this org — prevents cross-org product injection.
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

    -- Insert the invoice line.
    insert into vendor_invoice_lines (
      invoice_id, product_id, quantity, unit_cost_cents, line_total_cents
    ) values (
      v_invoice_id, v_product_id, v_quantity, v_unit_cost, v_line_total
    );

    -- Append a stock_ledger entry (stock arriving = positive quantity_delta).
    insert into stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, unit_cost_cents, created_by
    ) values (
      v_org_id, p_branch_id, v_product_id, v_quantity,
      'vendor_invoice', 'vendor_invoice', v_invoice_id, v_unit_cost, v_user_id
    );

    -- Upsert product_stock: create row if first delivery, otherwise increment.
    insert into product_stock (organisation_id, branch_id, product_id, quantity)
    values (v_org_id, p_branch_id, v_product_id, v_quantity)
    on conflict (branch_id, product_id)
    do update set
      quantity   = product_stock.quantity + excluded.quantity,
      updated_at = now();
  end loop;

  -- 7. Stamp the invoice total now that all lines are summed.
  update vendor_invoices set total_cents = v_total where id = v_invoice_id;

  -- 8. Return the new invoice id to the caller.
  return v_invoice_id;
end;
$$;

revoke all on function public.record_vendor_invoice from public;
grant execute on function public.record_vendor_invoice to authenticated;
