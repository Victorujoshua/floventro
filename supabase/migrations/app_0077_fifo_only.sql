-- ─────────────────────────────────────────────────────────────────────────────
-- app_0077_fifo_only.sql
--
-- Makes FIFO the only costing method.
--
-- 1. One-time backfill of uncosted pool stock at catalogue cost.
--    Opening-stock adjustments made before app_0074 added physical stock with
--    no FIFO layer and no weighted cost state. For every branch-pool position
--    where physical stock (product_stock) exceeds the units covered by FIFO
--    layers, and the product has a catalogue cost (products.unit_cost_cents),
--    the uncovered units get:
--      • an 'opening' FIFO layer at the catalogue cost (fresh sequence number,
--        so it drains after existing layers — same convention as app_0039 and
--        the app_0049 shortfall lot), and
--      • the matching weighted product_cost_state update (other movement
--        functions still maintain it).
--    Positions whose product has no catalogue cost are left uncosted — no cost
--    is invented. No stock quantities change and no ledger rows are written.
--    Re-running is a no-op: covered positions have no gap left.
--
--    At audit time (2026-09-26) this matched exactly:
--      EKEL (Orange Rep)            100 units @ ₦20,000
--      Mandalactone (Floventro LTD)  20 units @ ₦20,000
--      nivea cream (Della)           40 units @ ₦5,000
--    and left Kojitrinol Pad and Pskyn Liqueur (no catalogue cost) unknown.
--
-- 2. Every organisation → 'fifo'; default 'fifo'; only 'fifo' allowed.
--
-- Not changed: the weighted branches inside record_sale, record_service_usage,
-- add_service_consumption, pack_fulfilment_order and return_to_branch stay as
-- dead code (they only run when costing_method = 'weighted', which the new
-- check constraint makes impossible). Existing cogs_allocations rows are never
-- rewritten, so past sales keep their recorded cost and method_used.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. Backfill uncosted pool stock at catalogue cost
-- ╚══════════════════════════════════════════════════════════════════════════════

do $$
declare
  r            record;
  v_gap        integer;
  v_pool_qty   integer;
  v_pool_avg   bigint;
  v_pool_total bigint;
  v_new_qty    integer;
  v_new_total  bigint;
  v_new_avg    bigint;
begin
  for r in
    select ps.organisation_id, ps.branch_id, ps.product_id, ps.quantity as physical,
           p.name, p.unit_cost_cents,
           coalesce((
             select sum(cl.qty_remaining)
               from public.cost_layers cl
              where cl.branch_id      = ps.branch_id
                and cl.product_id     = ps.product_id
                and cl.holder_user_id is null
           ), 0) as layered
      from public.product_stock ps
      join public.products p on p.id = ps.product_id
     where ps.quantity > 0
       and p.unit_cost_cents is not null
     order by ps.updated_at, ps.id
     for update of ps
  loop
    v_gap := r.physical - r.layered;
    continue when v_gap <= 0;

    -- FIFO: opening layer for the uncovered units
    perform public.fifo_add_layer(
      r.organisation_id, r.branch_id, null, r.product_id,
      v_gap, r.unit_cost_cents,
      null,        -- fresh sequence number
      'opening',
      null
    );

    -- Weighted: same blend rule as receive_invoice_stock
    select quantity, avg_cost_cents, total_cost_cents
      into v_pool_qty, v_pool_avg, v_pool_total
      from public.product_cost_state
     where branch_id = r.branch_id and product_id = r.product_id and holder_user_id is null
     for update;

    v_pool_qty := coalesce(v_pool_qty, 0);
    v_new_qty  := v_pool_qty + v_gap;
    if v_pool_qty > 0 and v_pool_avg is null then
      v_new_total := null;   -- existing units of unknown cost: stays unknown
      v_new_avg   := null;
    else
      v_new_total := coalesce(v_pool_total, 0) + (v_gap::bigint * r.unit_cost_cents);
      v_new_avg   := v_new_total / v_new_qty;
    end if;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      r.organisation_id, r.branch_id, null, r.product_id,
      v_new_qty, v_new_avg, v_new_total
    )
    on conflict (branch_id, product_id) where holder_user_id is null
    do update set
      quantity         = excluded.quantity,
      avg_cost_cents   = excluded.avg_cost_cents,
      total_cost_cents = excluded.total_cost_cents,
      updated_at       = now();

    raise notice 'backfilled % units of "%" in branch % at % cents', v_gap, r.name, r.branch_id, r.unit_cost_cents;
  end loop;
end $$;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. FIFO only
-- ╚══════════════════════════════════════════════════════════════════════════════

update public.organisations
   set costing_method        = 'fifo',
       costing_method_set_at = now()
 where costing_method is distinct from 'fifo';

alter table public.organisations alter column costing_method set default 'fifo';

-- The original check was added directly on the live DB (see app_0042), so its
-- name isn't guaranteed — drop whichever check mentions costing_method.
do $$
declare
  v_con record;
begin
  for v_con in
    select conname
      from pg_constraint
     where conrelid = 'public.organisations'::regclass
       and contype  = 'c'
       and pg_get_constraintdef(oid) ilike '%costing_method%'
  loop
    execute format('alter table public.organisations drop constraint %I', v_con.conname);
  end loop;
end $$;

alter table public.organisations
  add constraint organisations_costing_method_check check (costing_method = 'fifo');

commit;
