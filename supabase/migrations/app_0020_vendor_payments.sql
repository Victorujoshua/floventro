-- ─────────────────────────────────────────────────────────────────────────────
-- app_0020_vendor_payments.sql
--
-- Completes the payables loop: vendor_payments table + record_vendor_payment RPC.
--
-- Design:
--   vendor_payments  — append-only payment log (source of truth).
--                      No updated_at / deleted_at — immutable once recorded.
--   vendor_invoices.amount_paid_cents — cached derivative, updated by the RPC.
--   vendor_invoices.status            — derived inside the RPC, never set manually.
--
-- Overpayment guard uses FOR UPDATE on the invoice row, serialising concurrent
-- payments the same way app_0017 serialised concurrent stock approvals.
--
-- Pre-apply check (must return 0):
--   select count(*) from vendor_invoices where amount_paid_cents > 0;
--
-- Depends on: app_0001_core  (organisations, branches)
--             app_0008_vendors (vendors)
--             app_0010_stock   (vendor_invoices)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. vendor_payments table ─────────────────────────────────────────────────

create table public.vendor_payments (
  id               uuid        primary key default gen_random_uuid(),
  organisation_id  uuid        not null references public.organisations(id)     on delete restrict,
  branch_id        uuid        not null references public.branches(id)           on delete restrict,
  vendor_id        uuid        not null references public.vendors(id)            on delete restrict,
  invoice_id       uuid        not null references public.vendor_invoices(id)    on delete restrict,
  amount_cents     bigint      not null check (amount_cents > 0),
  paid_on          date        not null default current_date,
  method           text        not null check (method in ('bank_transfer','cash','cheque','pos','other')),
  reference        text,
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid        references auth.users(id)
  -- No updated_at, no deleted_at: payments are immutable once recorded.
  -- Corrections are made via a reversing entry (future feature), never by editing.
);

create index vendor_payments_invoice_idx
  on public.vendor_payments (invoice_id);

create index vendor_payments_branch_vendor_idx
  on public.vendor_payments (branch_id, vendor_id);

create index vendor_payments_branch_date_idx
  on public.vendor_payments (branch_id, paid_on);

-- ── 2. RLS on vendor_payments ────────────────────────────────────────────────
--
-- SELECT: branch members may read payments in their branch (same guard as invoices).
-- INSERT / UPDATE / DELETE: no user policies — all writes reserved for the
-- security-definer RPC below. This is the same lock-down used for stock_ledger
-- and product_stock: the RPC is the only path that can write payments, which
-- guarantees vendor_invoices.amount_paid_cents can never drift from this table.

alter table public.vendor_payments enable row level security;

create policy "read vendor_payments in own branch"
  on public.vendor_payments
  for select
  using (
    branch_id in (select public.user_vendor_read_branch_ids())
  );

-- ── 3. record_vendor_payment RPC ─────────────────────────────────────────────
--
-- Records one payment against a vendor invoice, updates amount_paid_cents,
-- and derives the resulting status. Returns the new status string.
--
-- Concurrency safety: SELECT … FOR UPDATE on the invoice row serialises
-- concurrent payments on the same invoice, preventing two callers from both
-- passing the overpayment guard before either has committed.

create or replace function public.record_vendor_payment(
  p_invoice_id   uuid,
  p_amount_cents bigint,
  p_paid_on      date,
  p_method       text,
  p_reference    text,
  p_note         text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_inv         vendor_invoices%rowtype;
  v_outstanding bigint;
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

  -- Overpayment guard
  v_outstanding := v_inv.total_cents - v_inv.amount_paid_cents;

  if v_outstanding <= 0 then
    raise exception 'this invoice is already fully paid';
  end if;

  if p_amount_cents > v_outstanding then
    raise exception 'payment exceeds the outstanding balance (outstanding: %, attempted: %)',
      v_outstanding, p_amount_cents;
  end if;

  -- Record the payment row
  insert into public.vendor_payments (
    organisation_id, branch_id, vendor_id, invoice_id,
    amount_cents, paid_on, method, reference, note, created_by
  ) values (
    v_inv.organisation_id, v_inv.branch_id, v_inv.vendor_id, p_invoice_id,
    p_amount_cents,
    coalesce(p_paid_on, current_date),
    p_method,
    nullif(trim(p_reference), ''),
    nullif(trim(p_note), ''),
    v_user_id
  );

  -- Update the cached total and derive status from arithmetic — never manually set
  v_new_paid := v_inv.amount_paid_cents + p_amount_cents;

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

revoke all    on function public.record_vendor_payment(uuid, bigint, date, text, text, text) from public;
grant execute on function public.record_vendor_payment(uuid, bigint, date, text, text, text) to authenticated;
