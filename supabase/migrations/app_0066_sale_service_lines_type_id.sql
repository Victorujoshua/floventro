-- ─────────────────────────────────────────────────────────────────────────────
-- app_0066_sale_service_lines_type_id.sql
--
-- The live sale_service_lines table is missing service_type_id — the column
-- exists in the app_0054 CREATE TABLE definition but was not present in the
-- version of that migration that ran against the live DB.
--
-- Fix: add the column idempotently. Existing rows get NULL (correct: they
-- predate the column). The record_sale RPC insert now succeeds.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sale_service_lines
  add column if not exists service_type_id uuid
    references public.service_types(id) on delete set null;

notify pgrst, 'reload schema';
