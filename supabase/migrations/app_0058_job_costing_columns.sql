-- ─────────────────────────────────────────────────────────────────────────────
-- app_0058_job_costing_columns.sql
--
-- Phase 4a: adds job-costing snapshot columns to service_records.
-- Schema only — record_service_usage is NOT modified here (Phase 4b).
--
-- New columns on service_records:
--   client_plan_id        uuid references client_plans(id) — nullable.
--                         Set by Phase 4b RPC when the session is recorded
--                         under a client subscription. NULL for unlinked sessions.
--   session_revenue_cents bigint — nullable.
--                         Snapshot of price_paid_cents ÷ sessions_total at
--                         record time. Set alongside client_plan_id in Phase 4b.
--                         NULL for sessions not linked to a plan.
--
-- Depends on: app_0026_service_usage (service_records table)
--             app_0057_job_costing_foundation (client_plans table)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.service_records
  add column if not exists client_plan_id        uuid references public.client_plans (id),
  add column if not exists session_revenue_cents bigint;

create index if not exists service_records_client_plan_idx
  on public.service_records (client_plan_id);

notify pgrst, 'reload schema';
