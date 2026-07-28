-- ─────────────────────────────────────────────────────────────────────────────
-- app_0045_repair_holder.sql
--
-- ALREADY APPLIED TO PRODUCTION — repo record only, do not re-run.
-- Filed 2026-07-28. Originally applied directly to Supabase SQL editor.
--
-- Targeted repair for holder 62d20600-29c9-4b52-b68d-a3e86e610650
-- product bdea271e-02fa-4cb5-af13-488d94b818b4 (Pskyn Liquer, PSKN-01)
-- branch  dbd3068a-911e-41c0-8f53-84815b196c41 (HeadQuaters, Orange Box)
--
-- Root cause:
--   18 units exist in staff_holdings with no FIFO lot coverage. These units
--   predated the weighted costing migrations (app_0033–0035). product_cost_state
--   only tracked the 30 units issued on July 25 minus the 10 sold that day = 20.
--   The opening-layer migration (app_0039, July 26 08:38) created one 'opening'
--   lot for qty=20. The return_to_branch at 09:12 drained all 20, leaving
--   cost_layers empty. The remaining 18 units in staff_holdings have no FIFO
--   coverage, so every subsequent record_sale raises drain_fifo_layers error.
--
-- Fix:
--   1. INSERT a synthetic 'opening' cost_layers row: 18 units @ ₦560.00
--      (56000 cents) — the same unit_cost_cents as the exhausted opening lot.
--   2. UPDATE product_cost_state for this holder bucket: qty=18, avg=56000.
--      (The row exists at qty=0 — verified by diagnostic query.)
--
-- Guards:
--   - Aborts if staff_holdings.quantity ≠ 18 (wrong environment or already repaired).
--   - Aborts if any active cost_layers already exist for this bucket (already repaired).
--   - Aborts if product_cost_state UPDATE touches 0 rows (row missing).
--
-- Safe re-run: NO. cost_layers has no unique constraint on (branch, holder, product)
-- for the same source_ref_type. The guards above will abort if re-run after repair.
--
-- Apply after: app_0044, or independently — no hard dependency.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_org_id  uuid;
  v_updated integer;
begin

  -- Resolve org_id from branch
  select organisation_id into v_org_id
    from public.branches
   where id = 'dbd3068a-911e-41c0-8f53-84815b196c41';

  if v_org_id is null then
    raise exception 'Branch not found — wrong environment?';
  end if;

  -- ── Guard 1: staff_holdings must be exactly 18 ────────────────────────────
  if not exists (
    select 1
      from public.staff_holdings
     where branch_id      = 'dbd3068a-911e-41c0-8f53-84815b196c41'
       and holder_user_id = '62d20600-29c9-4b52-b68d-a3e86e610650'
       and product_id     = 'bdea271e-02fa-4cb5-af13-488d94b818b4'
       and quantity       = 18
  ) then
    raise exception
      'Guard failed: staff_holdings.quantity ≠ 18 for this holder+product. '
      'Do not proceed — verify current holdings and re-derive the repair quantities.';
  end if;

  -- ── Guard 2: no active cost_layers must exist for this bucket ─────────────
  if exists (
    select 1
      from public.cost_layers
     where branch_id      = 'dbd3068a-911e-41c0-8f53-84815b196c41'
       and holder_user_id = '62d20600-29c9-4b52-b68d-a3e86e610650'
       and product_id     = 'bdea271e-02fa-4cb5-af13-488d94b818b4'
       and qty_remaining  > 0
  ) then
    raise exception
      'Guard failed: active cost_layers already exist for this holder+product. '
      'The bucket may have been repaired already — do not double-insert.';
  end if;

  -- ── Create FIFO lot for the 18 uncovered units ────────────────────────────
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
  ) values (
    v_org_id,
    'dbd3068a-911e-41c0-8f53-84815b196c41',
    '62d20600-29c9-4b52-b68d-a3e86e610650',
    'bdea271e-02fa-4cb5-af13-488d94b818b4',
    nextval('public.cost_layer_seq'),
    18,
    56000,          -- ₦560.00 — matches exhausted opening layer unit_cost_cents
    'opening',
    null
  );

  -- ── Resync weighted engine: UPDATE the existing row (verified qty=0) ──────
  update public.product_cost_state
     set quantity         = 18,
         avg_cost_cents   = 56000,
         total_cost_cents = 18 * 56000,   -- 1008000 cents = ₦10,080.00
         updated_at       = now()
   where branch_id        = 'dbd3068a-911e-41c0-8f53-84815b196c41'
     and holder_user_id   = '62d20600-29c9-4b52-b68d-a3e86e610650'
     and product_id       = 'bdea271e-02fa-4cb5-af13-488d94b818b4';

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception
      'product_cost_state UPDATE matched 0 rows — row does not exist. '
      'Switch the UPDATE to an INSERT and re-run.';
  end if;

  raise notice
    'Repair complete: cost_layers 1 row inserted (18 units @ 56000 cents). '
    'product_cost_state updated (qty=18, avg=56000, total=1008000).';

end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Post-apply verification queries (run manually after applying above)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Active FIFO lots for this holder+product — expect 1 row, qty_remaining=18
-- select original_seq, qty_remaining, unit_cost_cents, source_ref_type, created_at
--   from public.cost_layers
--  where branch_id      = 'dbd3068a-911e-41c0-8f53-84815b196c41'
--    and holder_user_id = '62d20600-29c9-4b52-b68d-a3e86e610650'
--    and product_id     = 'bdea271e-02fa-4cb5-af13-488d94b818b4'
--    and qty_remaining  > 0;

-- 2. Weighted state — expect qty=18, avg=56000
-- select quantity, avg_cost_cents, total_cost_cents
--   from public.product_cost_state
--  where branch_id      = 'dbd3068a-911e-41c0-8f53-84815b196c41'
--    and holder_user_id = '62d20600-29c9-4b52-b68d-a3e86e610650'
--    and product_id     = 'bdea271e-02fa-4cb5-af13-488d94b818b4';

-- 3. Consistency check — expect 0 rows (fifo_qty = weighted_qty)
-- select pcs.branch_id, pcs.holder_user_id, pcs.product_id,
--        pcs.quantity as weighted_qty, coalesce(sum(cl.qty_remaining),0) as fifo_qty
--   from public.product_cost_state pcs
--   left join public.cost_layers cl
--     on  cl.branch_id      = pcs.branch_id
--     and cl.product_id     = pcs.product_id
--     and cl.holder_user_id is not distinct from pcs.holder_user_id
--     and cl.qty_remaining  > 0
--  where pcs.branch_id      = 'dbd3068a-911e-41c0-8f53-84815b196c41'
--    and pcs.holder_user_id = '62d20600-29c9-4b52-b68d-a3e86e610650'
--    and pcs.product_id     = 'bdea271e-02fa-4cb5-af13-488d94b818b4'
--    and pcs.quantity       > 0
--  group by pcs.branch_id, pcs.holder_user_id, pcs.product_id, pcs.quantity
--  having pcs.quantity <> coalesce(sum(cl.qty_remaining), 0);
-- Expected: ZERO rows.
