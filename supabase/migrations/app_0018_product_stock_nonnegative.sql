-- ─────────────────────────────────────────────────────────────────────────────
-- app_0018_product_stock_nonnegative.sql
--
-- Adds a structural CHECK constraint to product_stock ensuring quantity can
-- never go negative, regardless of what the application layer does.
--
-- The review_stock_request RPC (app_0016, superseded by app_0017) guards against
-- negative stock in application logic. This constraint is the database-level
-- backstop: if a bug, a direct SQL write, or any future code path attempts to
-- push quantity below zero, Postgres will reject the write with a constraint
-- violation rather than silently corrupting stock data.
--
-- Pre-apply check (run this first — it must return zero rows):
--   select * from public.product_stock where quantity < 0;
--
-- Depends on: app_0010_stock (product_stock table)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.product_stock
  add constraint product_stock_quantity_nonnegative
  check (quantity >= 0);
