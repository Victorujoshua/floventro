-- ─────────────────────────────────────────────────────────────────────────────
-- app_0072_sale_payments_read_scope.sql
--
-- Tightens read access on sale_payments to match the parent sale.
--
-- app_0031 let any member of a branch read every payment row in it
-- (user_vendor_read_branch_ids), while sales themselves are only readable by
-- their seller or by owner/admin/inventory (user_readable_sale_ids, app_0024).
-- A sales-role member could therefore read amounts, dates and notes of
-- payments on other sellers' sales that they cannot otherwise see.
--
-- Payments are now readable exactly when the parent sale is — the same rule
-- sale_lines and sale_service_lines already use. Nothing that reads payments
-- through a visible sale loses access (e.g. the revenue split's embedded
-- sale_payments(id) on sales queries, or the sale detail's payment history).
--
-- Writes are unchanged: still RPC-only via record_sale_payment.
--
-- Depends on: app_0024_sales (user_readable_sale_ids), app_0031_sales_payment
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "read sale_payments in own branch" on public.sale_payments;

create policy "read sale_payments via parent sale"
  on public.sale_payments
  for select
  using (
    sale_id in (select public.user_readable_sale_ids())
  );
