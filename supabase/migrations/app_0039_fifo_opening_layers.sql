-- ─────────────────────────────────────────────────────────────────────────────
-- app_0039_fifo_opening_layers.sql
--
-- Backfills one synthetic cost_layers row ("opening layer") per bucket from the
-- current product_cost_state, so that drain_fifo_layers() can serve every
-- existing bucket without shortfall.
--
-- Without this migration:
--   All stock that existed before app_0036 has product_cost_state entries but
--   NO cost_layers rows. Any FIFO inflow RPC (app_0038) that tries to drain
--   those buckets via drain_fifo_layers() will raise "cost_layers exhausted".
--   This migration is the bridge between the weighted history and the live FIFO
--   engine.
--
-- What it creates:
--   ONE row per product_cost_state bucket (branch × holder × product) with
--   quantity > 0 and no existing cost_layers rows.
--   qty_remaining = product_cost_state.quantity  — the full current position.
--   unit_cost_cents = product_cost_state.avg_cost_cents  — NULL if unknown.
--   source_ref_type = 'opening'  (CHECK constraint allows this value).
--   original_seq = nextval('cost_layer_seq')  — a fresh global seq assigned in
--     updated_at, id order so the relative ordering of opening layers is stable
--     and deterministic on repeated development runs.
--
-- ⚠ APPLY THIS BEFORE app_0038 CREATES ANY cost_layers ROWS ⚠
--   Because cost_layer_seq is monotonically increasing, opening layers must
--   receive the LOWEST sequence numbers in the system — only then will FIFO
--   drain them before any post-0036 new receipts. If new stock has already been
--   received via app_0038-enabled RPCs before this migration runs, those new
--   receipts will have lower seqs than the opening layers and will be drained
--   first (correct for that new stock, but the "old" opening stock will drain
--   later, which misrepresents the true purchase age). Safe ordering:
--     apply 0036 → apply 0037 → apply 0039 → apply 0038.
--   If 0038 must go first (for a zero-downtime rollout), apply 0039 immediately
--   after and before processing any stock movements.
--
-- Idempotency:
--   The NOT EXISTS guard skips any bucket that already has at least one
--   cost_layers row (regardless of qty_remaining). Safe to re-run; no duplicate
--   layers will be created for any bucket that has been touched by 0038 RPCs.
--
-- Depends on:
--   app_0033_costing_schema  (product_cost_state)
--   app_0036_fifo_schema     (cost_layers, cost_layer_seq)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Opening-layer backfill ────────────────────────────────────────────────────
--
-- SELECT is ordered by (updated_at, id) so nextval() calls are deterministic
-- across environments and test runs. PostgreSQL materialises the SELECT rows in
-- ORDER BY order and calls nextval() for each row sequentially, so the earliest-
-- updated bucket gets the lowest seq. Within a single apply this is the closest
-- approximation to "oldest position first" without a true historical record.

insert into public.cost_layers (
  organisation_id,
  branch_id,
  holder_user_id,
  product_id,
  original_seq,
  qty_remaining,
  unit_cost_cents,
  source_ref_type,
  source_ref_id
)
select
  pcs.organisation_id,
  pcs.branch_id,
  pcs.holder_user_id,
  pcs.product_id,
  nextval('public.cost_layer_seq'),   -- fresh seq; NULL p_original_seq path of fifo_add_layer
  pcs.quantity,                        -- full current position becomes the single opening lot
  pcs.avg_cost_cents,                  -- NULL if bucket had unknown weighted cost — stays unknown
  'opening',
  null                                 -- no specific source document; it's a synthetic snapshot
from public.product_cost_state pcs
where pcs.quantity > 0
  and not exists (
    -- Skip any bucket that already has cost_layers rows (exhausted or live).
    -- Prevents double-creation if this migration is re-run after 0038 has
    -- already produced layers for some buckets.
    select 1
      from public.cost_layers cl
     where cl.branch_id      = pcs.branch_id
       and cl.product_id     = pcs.product_id
       and cl.holder_user_id is not distinct from pcs.holder_user_id
  )
order by pcs.updated_at, pcs.id;


-- ── Consistency check (run after applying; expect zero rows) ─────────────────
--
-- Every bucket's FIFO layer sum must match its weighted quantity.
-- A non-empty result means a bucket is out of sync — investigate before
-- enabling FIFO moves on that product.
--
--   select
--     pcs.branch_id,
--     pcs.holder_user_id,
--     pcs.product_id,
--     pcs.quantity                        as weighted_qty,
--     coalesce(sum(cl.qty_remaining), 0)  as fifo_qty
--   from public.product_cost_state pcs
--   left join public.cost_layers cl
--     on  cl.branch_id      = pcs.branch_id
--     and cl.product_id     = pcs.product_id
--     and cl.holder_user_id is not distinct from pcs.holder_user_id
--     and cl.qty_remaining  > 0
--   where pcs.quantity > 0
--   group by pcs.branch_id, pcs.holder_user_id, pcs.product_id, pcs.quantity
--   having pcs.quantity <> coalesce(sum(cl.qty_remaining), 0);
--
-- Expect: ZERO rows.
