-- ─────────────────────────────────────────────────────────────────────────────
-- app_0076_remove_direct_transfer.sql
--
-- Removes direct inter-branch sending for every role. Stock now moves between
-- branches only through: destination requests (create_transfer_request) →
-- source approves (approve_transfer_request) → transfer created by the
-- internal transfer_stock_internal (app_0075).
--
-- initiate_transfer is dropped rather than left refusing all callers: nothing
-- calls it any more (approve_transfer_request uses transfer_stock_internal), so
-- keeping it would only leave a dead endpoint to maintain.
--
-- Untouched: transfer_stock_internal, approve_transfer_request,
-- receive_transfer, cancel_transfer, and all existing stock_transfers rows —
-- transfers already in transit are received or cancelled exactly as before.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.initiate_transfer(uuid, uuid, text, jsonb);

notify pgrst, 'reload schema';
