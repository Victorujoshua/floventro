-- Migration: app_0030_payout_accounts
-- Adds payout/bank account fields to organisations (org-level default)
-- and branches (optional per-branch override, null = inherit org default).
--
-- No new RLS policies needed:
--   "update own org"         on organisations → owners may UPDATE any column
--   "update branches as owner" on branches   → owners may UPDATE any column
-- Both existing policies already cover the new columns.

alter table public.organisations
  add column payout_account_name   text,
  add column payout_account_number text,
  add column payout_bank_name      text;

alter table public.branches
  add column payout_account_name   text,
  add column payout_account_number text,
  add column payout_bank_name      text;
