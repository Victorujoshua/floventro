-- ─────────────────────────────────────────────────────────────────────────────
-- app_0073_invoice_close_short.sql
--
-- Close a short vendor delivery, optionally with a vendor credit.
--
-- A vendor invoice line records what was ordered (quantity) and what has
-- arrived so far (quantity_received, accumulated across receive batches).
-- Until now a line whose remainder will never arrive stayed open forever and
-- its invoice stayed 'partially_received'. This migration lets the business
-- close that remainder out, and — if the vendor agrees — record a credit that
-- reduces what is owed.
--
-- Design:
--   • Closing is per LINE: vendor_invoice_lines.closed_short_at / _by / _note.
--     The undelivered gap is derived (quantity − quantity_received), never
--     stored, and quantity / quantity_received / unit_cost_cents are never
--     edited — same as inter-branch transfers (app_0028), where the shortfall
--     is sent − received. Invoices take several receive batches (transfers
--     take one), so an explicit close marker is needed to stop further batches.
--   • The invoice-level receipt_status gains 'closed_short': every line is
--     either fully received or closed, and at least one was closed with a gap.
--   • Closing is pure bookkeeping: it writes NO stock_ledger, product_stock,
--     product_cost_state or cost_layers rows.
--   • A vendor credit is an append-only vendor_credits row per closed line,
--     priced at that line's own unit_cost_cents × undelivered quantity — never
--     a lump sum — so the cost of units already received (weighted average and
--     FIFO layers, both at unit_cost_cents) is untouched. VAT on the credit uses
--     the invoice's vat_rate with cumulative rounding, so crediting an entire
--     invoice returns exactly its vat_cents.
--   • vendor_invoices caches credited_subtotal_cents / credited_cents (like
--     amount_paid_cents caches vendor_payments). Outstanding becomes
--     total_cents − credited_cents − amount_paid_cents everywhere.
--   • A credit may not exceed the current outstanding balance. If it would, the
--     vendor owes money back — a refund, which is out of scope. The business
--     can still close short without a credit.
--
-- Changes:
--   1. vendor_invoice_lines: closed_short_at, closed_short_by, closed_short_note
--   2. vendor_invoices: credited_subtotal_cents, credited_cents; receipt_status
--      check extended with 'closed_short'
--   3. vendor_credits table (append-only, RPC-only writes)
--   4. derive_invoice_receipt_status(invoice_id) — shared status derivation
--   5. receive_invoice_stock — rejects closed lines / closed invoices, locks the
--      invoice row first, derives status via (4). Stock, cost-state and FIFO
--      blocks are byte-identical to app_0044.
--   6. close_invoice_lines_short(invoice_id, line_ids, record_credit, note)
--   7. receive_and_close_invoice_lines — one transaction for the receive dialog
--   8. record_vendor_payment — outstanding and WHT base net of credits
--
-- Lock order (all invoice RPCs): vendor_invoices → vendor_invoice_lines →
-- product_stock → product_cost_state. Payments lock the invoice only.
--
-- Depends on: app_0020 (vendor_payments), app_0032 (VAT/WHT),
--             app_0044 (receive_invoice_stock), app_0072 (receipt columns)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. vendor_invoice_lines: close-short marker
-- ╚══════════════════════════════════════════════════════════════════════════════

alter table public.vendor_invoice_lines
  add column if not exists closed_short_at   timestamptz,
  add column if not exists closed_short_by   uuid references auth.users(id),
  add column if not exists closed_short_note text;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. vendor_invoices: cached credit totals + closed_short status
-- ╚══════════════════════════════════════════════════════════════════════════════

alter table public.vendor_invoices
  add column if not exists credited_subtotal_cents bigint not null default 0
    check (credited_subtotal_cents >= 0),
  add column if not exists credited_cents          bigint not null default 0
    check (credited_cents >= 0);

-- Replace whatever receipt_status check exists (its live name is unknown — see
-- app_0072) with one that allows 'closed_short'.
do $$
declare
  v_con record;
begin
  for v_con in
    select conname
      from pg_constraint
     where conrelid = 'public.vendor_invoices'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) ilike '%receipt_status%'
  loop
    execute format('alter table public.vendor_invoices drop constraint %I', v_con.conname);
  end loop;
end;
$$;

alter table public.vendor_invoices
  add constraint vendor_invoices_receipt_status_check
  check (receipt_status in ('pending', 'partially_received', 'received', 'closed_short'));


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 3. vendor_credits
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- One row per closed-short line that the vendor credited. Immutable, like
-- vendor_payments: no updated_at, no deleted_at, no user write policies.

create table if not exists public.vendor_credits (
  id               uuid        primary key default gen_random_uuid(),
  organisation_id  uuid        not null references public.organisations(id)        on delete restrict,
  branch_id        uuid        not null references public.branches(id)              on delete restrict,
  vendor_id        uuid        not null references public.vendors(id)               on delete restrict,
  invoice_id       uuid        not null references public.vendor_invoices(id)       on delete restrict,
  invoice_line_id  uuid        not null unique references public.vendor_invoice_lines(id) on delete restrict,
  quantity         integer     not null check (quantity > 0),
  unit_cost_cents  bigint      not null check (unit_cost_cents >= 0),
  subtotal_cents   bigint      not null check (subtotal_cents >= 0),
  vat_cents        bigint      not null default 0 check (vat_cents >= 0),
  amount_cents     bigint      not null check (amount_cents >= 0),
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid        references auth.users(id),
  constraint vendor_credits_subtotal_check check (subtotal_cents = quantity * unit_cost_cents),
  constraint vendor_credits_amount_check   check (amount_cents = subtotal_cents + vat_cents)
);

create index if not exists vendor_credits_invoice_idx
  on public.vendor_credits (invoice_id);

create index if not exists vendor_credits_branch_vendor_idx
  on public.vendor_credits (branch_id, vendor_id);

alter table public.vendor_credits enable row level security;

drop policy if exists "read vendor_credits in own branch" on public.vendor_credits;
create policy "read vendor_credits in own branch"
  on public.vendor_credits
  for select
  using (
    branch_id in (select public.user_vendor_read_branch_ids())
  );
-- No INSERT / UPDATE / DELETE policy — close_invoice_lines_short is the only writer.


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 4. derive_invoice_receipt_status
-- ╚══════════════════════════════════════════════════════════════════════════════
--
--   every line resolved (fully received or closed):
--       any closed line with a gap → 'closed_short', else 'received'
--   otherwise, any line received or closed → 'partially_received'
--   otherwise → 'pending'
--
-- Internal helper: callers already hold the invoice lock. Not granted to users.

create or replace function public.derive_invoice_receipt_status(p_invoice_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when bool_and(closed_short_at is not null or coalesce(quantity_received, 0) >= quantity) then
             case
               when bool_or(closed_short_at is not null and coalesce(quantity_received, 0) < quantity)
                 then 'closed_short'
               else 'received'
             end
           when bool_or(coalesce(quantity_received, 0) > 0 or closed_short_at is not null)
             then 'partially_received'
           else 'pending'
         end
    from public.vendor_invoice_lines
   where invoice_id = p_invoice_id;
$$;

revoke all on function public.derive_invoice_receipt_status(uuid) from public;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 5. receive_invoice_stock
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Changes vs app_0044 (marked [CHANGED]):
--   a. Invoice row selected FOR UPDATE — fixes the lock order against
--      close_invoice_lines_short and record_vendor_payment.
--   b. A closed_short invoice is rejected like a fully received one.
--   c. Line row selected FOR UPDATE; a closed line is rejected.
--   d. receipt_status comes from derive_invoice_receipt_status.
-- Stock ledger, product_stock, branch_products, weighted cost-state and FIFO
-- layer blocks are byte-identical to app_0044.

create or replace function public.receive_invoice_stock(
  p_invoice_id uuid,
  p_lines      jsonb,
  p_note       text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_inv          vendor_invoices%rowtype;
  v_line         jsonb;
  v_line_id      uuid;
  v_batch        integer;
  v_il           vendor_invoice_lines%rowtype;
  v_status       text;
  -- ── weighted cost-state accumulators ─────────────────────────────────────
  v_pool_qty     integer;
  v_pool_avg     bigint;
  v_pool_total   bigint;
  v_new_qty      integer;
  v_new_total    bigint;
  v_new_avg      bigint;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;

  -- [CHANGED a]
  select * into v_inv from vendor_invoices where id = p_invoice_id and deleted_at is null for update;
  if v_inv.id is null then raise exception 'invoice not found'; end if;
  if v_inv.receipt_status = 'received' then raise exception 'invoice is already fully received'; end if;
  -- [CHANGED b]
  if v_inv.receipt_status = 'closed_short' then raise exception 'invoice is closed short'; end if;

  if v_inv.branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to receive stock for this invoice';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no received lines provided';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id := (v_line->>'line_id')::uuid;
    v_batch   := (v_line->>'quantity_received')::integer;

    -- [CHANGED c]
    select * into v_il from vendor_invoice_lines where id = v_line_id and invoice_id = p_invoice_id for update;
    if v_il.id is null then raise exception 'line % not part of this invoice', v_line_id; end if;
    if v_il.closed_short_at is not null then raise exception 'line % is closed short', v_line_id; end if;

    if v_batch is null or v_batch <= 0 then raise exception 'received quantity must be greater than 0'; end if;

    if coalesce(v_il.quantity_received, 0) + v_batch > v_il.quantity then
      raise exception 'cannot receive more than ordered for a line (ordered %, already %, receiving %)',
        v_il.quantity, coalesce(v_il.quantity_received, 0), v_batch;
    end if;

    -- Lock the stock row (all cost-state locks follow this, preserving lock order).
    perform 1 from product_stock
      where branch_id = v_inv.branch_id and product_id = v_il.product_id for update;

    insert into stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, unit_cost_cents, created_by
    ) values (
      v_inv.organisation_id, v_inv.branch_id, v_il.product_id, v_batch,
      'vendor_invoice', 'vendor_invoice', p_invoice_id, v_il.unit_cost_cents, v_user_id
    );

    insert into product_stock (organisation_id, branch_id, product_id, quantity)
    values (v_inv.organisation_id, v_inv.branch_id, v_il.product_id, v_batch)
    on conflict (branch_id, product_id)
    do update set
      quantity   = product_stock.quantity + excluded.quantity,
      updated_at = now();

    update vendor_invoice_lines
       set quantity_received = coalesce(quantity_received, 0) + v_batch
     where id = v_line_id;

    -- ── NEW (branch_products) ─────────────────────────────────────────────────
    insert into public.branch_products (organisation_id, branch_id, product_id)
    values (v_inv.organisation_id, v_inv.branch_id, v_il.product_id)
    on conflict (branch_id, product_id) do nothing;
    -- ── END NEW ───────────────────────────────────────────────────────────────

    -- ── weighted-average cost into branch pool ────────────────────────────────
    -- in_cost = v_il.unit_cost_cents (always non-null — validated at invoice creation).
    select quantity, avg_cost_cents, total_cost_cents
      into v_pool_qty, v_pool_avg, v_pool_total
      from public.product_cost_state
     where branch_id      = v_inv.branch_id
       and product_id     = v_il.product_id
       and holder_user_id is null
     for update;

    v_pool_qty := coalesce(v_pool_qty, 0);
    v_new_qty  := v_pool_qty + v_batch;

    if v_pool_qty > 0 and v_pool_avg is null then
      -- Tainted bucket: existing units have unknown cost. Cannot honestly blend
      -- known-cost arrivals with them. avg stays NULL; qty still grows.
      v_new_total := null;
      v_new_avg   := null;
    else
      -- Normal weighted-average.
      v_new_total := coalesce(v_pool_total, 0) + (v_batch * v_il.unit_cost_cents);
      v_new_avg   := v_new_total / v_new_qty;
    end if;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      v_inv.organisation_id, v_inv.branch_id, null, v_il.product_id,
      v_new_qty, v_new_avg, v_new_total
    )
    on conflict (branch_id, product_id) where holder_user_id is null
    do update set
      quantity         = excluded.quantity,
      avg_cost_cents   = excluded.avg_cost_cents,
      total_cost_cents = excluded.total_cost_cents,
      updated_at       = now();
    -- ── END weighted ──────────────────────────────────────────────────────────

    -- ── NEW (FIFO): create a lot for this received batch ──────────────────────
    -- p_original_seq=NULL → fifo_add_layer assigns a fresh global seq via nextval.
    -- This is new stock entering the system for the first time; it must never
    -- carry a pre-existing seq (that would corrupt the global FIFO order).
    -- unit_cost_cents carries directly from the invoice line — same as weighted.
    perform public.fifo_add_layer(
      v_inv.organisation_id,
      v_inv.branch_id,
      null,                     -- branch pool bucket (holder_user_id = null)
      v_il.product_id,
      v_batch,
      v_il.unit_cost_cents,     -- NULL only if invoice line had no cost (edge case)
      null,                     -- new stock → assign fresh seq
      'vendor_invoice',
      p_invoice_id
    );
    -- ── END NEW (FIFO) ────────────────────────────────────────────────────────

  end loop;

  -- [CHANGED d]
  v_status := public.derive_invoice_receipt_status(p_invoice_id);

  update vendor_invoices
     set receipt_status = v_status,
         note       = coalesce(nullif(trim(p_note), ''), note),
         updated_at = now()
   where id = p_invoice_id;

  return v_status;
end;
$$;
revoke all    on function public.receive_invoice_stock(uuid, jsonb, text) from public;
grant execute on function public.receive_invoice_stock(uuid, jsonb, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 6. close_invoice_lines_short
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Closes each listed line's undelivered remainder (quantity − quantity_received).
-- Bookkeeping only: touches vendor_invoice_lines, vendor_credits and
-- vendor_invoices — never stock_ledger, product_stock, product_cost_state or
-- cost_layers.
--
-- p_record_credit = true inserts one vendor_credits row per line at
--   remainder × the line's unit_cost_cents, plus VAT at the invoice's vat_rate,
--   and reduces what is owed. Refused if the credit exceeds the outstanding
--   balance (that would be a vendor refund — not supported).
--
-- Returns the invoice's new receipt_status.

create or replace function public.close_invoice_lines_short(
  p_invoice_id    uuid,
  p_line_ids      uuid[],
  p_record_credit boolean,
  p_note          text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id        uuid := auth.uid();
  v_inv            vendor_invoices%rowtype;
  v_il             vendor_invoice_lines%rowtype;
  v_line_id        uuid;
  v_remaining      integer;
  v_note           text := nullif(trim(p_note), '');
  v_line_subtotal  bigint;
  v_line_vat       bigint;
  v_sub_before     bigint;
  v_sub_after      bigint;
  v_credit_total   bigint := 0;
  v_outstanding    bigint;
  v_new_credited   bigint;
  v_effective      bigint;
  v_pay_status     text;
  v_status         text;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;

  select * into v_inv from vendor_invoices where id = p_invoice_id and deleted_at is null for update;
  if v_inv.id is null then raise exception 'invoice not found'; end if;

  if v_inv.branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to close lines on this invoice';
  end if;

  if p_line_ids is null or cardinality(p_line_ids) = 0 then
    raise exception 'no lines to close';
  end if;

  v_sub_before := v_inv.credited_subtotal_cents;

  foreach v_line_id in array p_line_ids
  loop
    select * into v_il from vendor_invoice_lines where id = v_line_id and invoice_id = p_invoice_id for update;
    if v_il.id is null then raise exception 'line % not part of this invoice', v_line_id; end if;
    if v_il.closed_short_at is not null then raise exception 'line % is already closed short', v_line_id; end if;

    v_remaining := v_il.quantity - coalesce(v_il.quantity_received, 0);
    if v_remaining <= 0 then raise exception 'line % is fully received — nothing to close', v_line_id; end if;

    update vendor_invoice_lines
       set closed_short_at   = now(),
           closed_short_by   = v_user_id,
           closed_short_note = v_note
     where id = v_line_id;

    if p_record_credit then
      -- Priced at this line's own unit cost — never a lump sum.
      v_line_subtotal := v_remaining * v_il.unit_cost_cents;
      -- Cumulative VAT rounding: credits across an invoice sum to exactly its
      -- vat_cents when everything is credited.
      v_sub_after := v_sub_before + v_line_subtotal;
      v_line_vat  := round(v_sub_after  * coalesce(v_inv.vat_rate, 0) / 100.0)
                   - round(v_sub_before * coalesce(v_inv.vat_rate, 0) / 100.0);

      insert into vendor_credits (
        organisation_id, branch_id, vendor_id, invoice_id, invoice_line_id,
        quantity, unit_cost_cents, subtotal_cents, vat_cents, amount_cents,
        note, created_by
      ) values (
        v_inv.organisation_id, v_inv.branch_id, v_inv.vendor_id, p_invoice_id, v_line_id,
        v_remaining, v_il.unit_cost_cents, v_line_subtotal, v_line_vat, v_line_subtotal + v_line_vat,
        v_note, v_user_id
      );

      v_sub_before   := v_sub_after;
      v_credit_total := v_credit_total + v_line_subtotal + v_line_vat;
    end if;
  end loop;

  v_new_credited := v_inv.credited_cents + v_credit_total;

  if v_credit_total > 0 then
    v_outstanding := v_inv.total_cents - v_inv.credited_cents - v_inv.amount_paid_cents;
    if v_credit_total > v_outstanding then
      raise exception 'credit (%) exceeds the outstanding balance (%)', v_credit_total, v_outstanding;
    end if;
  end if;

  -- Payment status against what is now owed (total net of credits).
  v_effective := v_inv.total_cents - v_new_credited;
  if v_inv.amount_paid_cents >= v_effective then
    v_pay_status := 'paid';
  elsif v_inv.amount_paid_cents > 0 then
    v_pay_status := 'partial';
  else
    v_pay_status := 'unpaid';
  end if;

  v_status := public.derive_invoice_receipt_status(p_invoice_id);

  update vendor_invoices
     set credited_subtotal_cents = v_sub_before,
         credited_cents          = v_new_credited,
         status                  = v_pay_status,
         receipt_status          = v_status,
         note                    = coalesce(v_note, note),
         updated_at              = now()
   where id = p_invoice_id;

  return v_status;
end;
$$;
revoke all    on function public.close_invoice_lines_short(uuid, uuid[], boolean, text) from public;
grant execute on function public.close_invoice_lines_short(uuid, uuid[], boolean, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 7. receive_and_close_invoice_lines
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- The receive dialog's single action: receive any batches, then close any
-- lines short, in one transaction — a failure in either rolls back both.

create or replace function public.receive_and_close_invoice_lines(
  p_invoice_id     uuid,
  p_lines          jsonb,   -- [{ line_id, quantity_received }], may be empty
  p_close_line_ids uuid[],  -- may be empty
  p_record_credit  boolean,
  p_note           text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_receipts boolean := p_lines is not null and jsonb_array_length(p_lines) > 0;
  v_has_closes   boolean := p_close_line_ids is not null and cardinality(p_close_line_ids) > 0;
  v_status       text;
begin
  if not v_has_receipts and not v_has_closes then
    raise exception 'nothing to receive or close';
  end if;

  if v_has_receipts then
    v_status := public.receive_invoice_stock(p_invoice_id, p_lines, p_note);
  end if;

  if v_has_closes then
    v_status := public.close_invoice_lines_short(p_invoice_id, p_close_line_ids, coalesce(p_record_credit, false), p_note);
  end if;

  return v_status;
end;
$$;
revoke all    on function public.receive_and_close_invoice_lines(uuid, jsonb, uuid[], boolean, text) from public;
grant execute on function public.receive_and_close_invoice_lines(uuid, jsonb, uuid[], boolean, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 8. record_vendor_payment — net of credits
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Changes vs app_0032 (marked [CHANGED]):
--   a. WHT base is the subtotal net of credited subtotal.
--   b. Outstanding and paid status use total_cents − credited_cents.
-- Signature unchanged.

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
  v_effective   bigint;
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

  -- [CHANGED a] WHT base is the PRE-VAT subtotal net of credits.
  v_wht_cents  := round((v_inv.subtotal_cents - v_inv.credited_subtotal_cents) * coalesce(p_wht_rate, 0) / 100.0);
  v_settlement := p_amount_cents + v_wht_cents;

  -- [CHANGED b] Overpayment guard against the total net of credits.
  v_effective   := v_inv.total_cents - v_inv.credited_cents;
  v_outstanding := v_effective - v_inv.amount_paid_cents;

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
  elsif v_new_paid < v_effective then
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

notify pgrst, 'reload schema';
