-- ─────────────────────────────────────────────────────────────────────────────
-- app_0048_fifo_gap_backfill.sql
--
-- Repairs 8 FIFO-desync'd buckets where product_stock / staff_holdings exceed
-- cost_layers coverage. Root cause: stock predated the FIFO migration (app_0036)
-- and/or the opening-layer migration (app_0039) skipped buckets that already had
-- exhausted layers (the NOT EXISTS guard fired, treating "has any row" as covered).
--
-- Diagnosed 2026-08-02 via scripts/diagnose-fifo-gap.mjs.
--
-- GROUP A — no product_cost_state row (cost unknowable; NULL throughout):
--   A1. Main       / Hollandia (1L)    pool              +50  @ NULL
--   A2. Main       / Hollandia (200ML) pool              +100 @ NULL
--   A3. Branch B   / Pskyn Liquer      pool              +28  @ NULL
--   A4. Ogba       / Ps crema (Pl oo)  pool              +12  @ NULL
--   A5. Lekki      / Ps crema (Pl oo)  holder b1b02a83   +35  @ NULL
--
-- GROUP B — PCS exists; gap units inherit the stored PCS avg (same avg → avg unchanged):
--   B1. HeadQuaters / Pskyn Liquer     pool              +4380 @ 3,774,314 ¢
--   B2. Lekki       / Ps crema (Pl oo) pool              +147  @ 550,000 ¢
--   B3. Lekki       / Ps crema (Pl oo) holder f374c145   +8    @ 550,000 ¢
--
-- Each block:
--   1. Idempotent skip  — if layers already cover stock, RAISE NOTICE and RETURN.
--   2. State guards     — abort if stock_qty / layer_qty / PCS values differ from
--                          the diagnostic snapshot (stock moved since measurement).
--   3. INSERT cost_layers for the gap units.
--   4. INSERT / UPDATE product_cost_state so the weighted engine matches FIFO.
--
-- DO NOT apply without operator review.
-- Depends on: app_0033_costing_schema, app_0036_fifo_schema
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ A1. Main / Hollandia (1L) — pool, +50 units @ NULL cost
-- ╚══════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_org_id    uuid    := 'd0b6ceea-fed9-4578-8c49-18ac59af940f';
  v_branch    uuid    := 'd535ca61-cf16-46d9-bd31-14dea990e9d2';
  v_product   uuid    := '145a49d5-5aab-4857-9bf3-c641227ae4a1';
  v_stock_qty integer;
  v_layer_qty bigint;
begin
  select coalesce(quantity, 0) into v_stock_qty
    from public.product_stock
   where branch_id = v_branch and product_id = v_product;

  select coalesce(sum(qty_remaining), 0) into v_layer_qty
    from public.cost_layers
   where branch_id      = v_branch
     and product_id     = v_product
     and holder_user_id is null
     and qty_remaining  > 0;

  if v_layer_qty >= v_stock_qty then
    raise notice 'A1 Main/Hollandia(1L) pool: already covered (layers=%, stock=%), skipping.', v_layer_qty, v_stock_qty;
    return;
  end if;

  if v_stock_qty <> 50 then
    raise exception 'A1 Guard: expected stock_qty=50, got %. Stock moved since diagnosis — re-derive.', v_stock_qty;
  end if;
  if v_layer_qty <> 0 then
    raise exception 'A1 Guard: expected layer_qty=0, got %. Investigate before proceeding.', v_layer_qty;
  end if;

  insert into public.cost_layers (
    organisation_id, branch_id, holder_user_id, product_id,
    original_seq, qty_remaining, unit_cost_cents, source_ref_type, source_ref_id
  ) values (
    v_org_id, v_branch, null, v_product,
    nextval('public.cost_layer_seq'), 50, null, 'opening', null
  );

  -- No PCS row existed; create one with NULL cost (stock predates costing system).
  insert into public.product_cost_state (
    organisation_id, branch_id, holder_user_id, product_id,
    quantity, avg_cost_cents, total_cost_cents
  ) values (
    v_org_id, v_branch, null, v_product,
    50, null, null
  )
  on conflict (branch_id, product_id) where holder_user_id is null
  do update set
    quantity         = 50,
    avg_cost_cents   = null,
    total_cost_cents = null,
    updated_at       = now();

  raise notice 'A1 Main/Hollandia(1L) pool: repaired (+50 units @ NULL cost).';
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ A2. Main / Hollandia (200ML) — pool, +100 units @ NULL cost
-- ╚══════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_org_id    uuid    := 'd0b6ceea-fed9-4578-8c49-18ac59af940f';
  v_branch    uuid    := 'd535ca61-cf16-46d9-bd31-14dea990e9d2';
  v_product   uuid    := '2351dbc8-3ec2-47f7-841f-232c3706fb36';
  v_stock_qty integer;
  v_layer_qty bigint;
begin
  select coalesce(quantity, 0) into v_stock_qty
    from public.product_stock
   where branch_id = v_branch and product_id = v_product;

  select coalesce(sum(qty_remaining), 0) into v_layer_qty
    from public.cost_layers
   where branch_id      = v_branch
     and product_id     = v_product
     and holder_user_id is null
     and qty_remaining  > 0;

  if v_layer_qty >= v_stock_qty then
    raise notice 'A2 Main/Hollandia(200ML) pool: already covered (layers=%, stock=%), skipping.', v_layer_qty, v_stock_qty;
    return;
  end if;

  if v_stock_qty <> 100 then
    raise exception 'A2 Guard: expected stock_qty=100, got %. Stock moved since diagnosis — re-derive.', v_stock_qty;
  end if;
  if v_layer_qty <> 0 then
    raise exception 'A2 Guard: expected layer_qty=0, got %. Investigate before proceeding.', v_layer_qty;
  end if;

  insert into public.cost_layers (
    organisation_id, branch_id, holder_user_id, product_id,
    original_seq, qty_remaining, unit_cost_cents, source_ref_type, source_ref_id
  ) values (
    v_org_id, v_branch, null, v_product,
    nextval('public.cost_layer_seq'), 100, null, 'opening', null
  );

  insert into public.product_cost_state (
    organisation_id, branch_id, holder_user_id, product_id,
    quantity, avg_cost_cents, total_cost_cents
  ) values (
    v_org_id, v_branch, null, v_product,
    100, null, null
  )
  on conflict (branch_id, product_id) where holder_user_id is null
  do update set
    quantity         = 100,
    avg_cost_cents   = null,
    total_cost_cents = null,
    updated_at       = now();

  raise notice 'A2 Main/Hollandia(200ML) pool: repaired (+100 units @ NULL cost).';
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ A3. Branch B / Pskyn Liquer — pool, +28 units @ NULL cost
-- ╚══════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_org_id    uuid    := '9e12840d-452d-486e-8020-e0b41e7aa9ec';
  v_branch    uuid    := 'fd73d47e-8c14-41ef-9503-11e6d1cc8725';
  v_product   uuid    := 'bdea271e-02fa-4cb5-af13-488d94b818b4';
  v_stock_qty integer;
  v_layer_qty bigint;
begin
  select coalesce(quantity, 0) into v_stock_qty
    from public.product_stock
   where branch_id = v_branch and product_id = v_product;

  select coalesce(sum(qty_remaining), 0) into v_layer_qty
    from public.cost_layers
   where branch_id      = v_branch
     and product_id     = v_product
     and holder_user_id is null
     and qty_remaining  > 0;

  if v_layer_qty >= v_stock_qty then
    raise notice 'A3 Branch B/Pskyn pool: already covered (layers=%, stock=%), skipping.', v_layer_qty, v_stock_qty;
    return;
  end if;

  if v_stock_qty <> 28 then
    raise exception 'A3 Guard: expected stock_qty=28, got %. Stock moved since diagnosis — re-derive.', v_stock_qty;
  end if;
  if v_layer_qty <> 0 then
    raise exception 'A3 Guard: expected layer_qty=0, got %. Investigate before proceeding.', v_layer_qty;
  end if;

  insert into public.cost_layers (
    organisation_id, branch_id, holder_user_id, product_id,
    original_seq, qty_remaining, unit_cost_cents, source_ref_type, source_ref_id
  ) values (
    v_org_id, v_branch, null, v_product,
    nextval('public.cost_layer_seq'), 28, null, 'opening', null
  );

  insert into public.product_cost_state (
    organisation_id, branch_id, holder_user_id, product_id,
    quantity, avg_cost_cents, total_cost_cents
  ) values (
    v_org_id, v_branch, null, v_product,
    28, null, null
  )
  on conflict (branch_id, product_id) where holder_user_id is null
  do update set
    quantity         = 28,
    avg_cost_cents   = null,
    total_cost_cents = null,
    updated_at       = now();

  raise notice 'A3 Branch B/Pskyn pool: repaired (+28 units @ NULL cost).';
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ A4. Ogba / Ps crema (Pl oo) — pool, +12 units @ NULL cost
-- ╚══════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_org_id    uuid    := '2e8e7431-b526-477e-95c9-528d9a75b2b8';
  v_branch    uuid    := 'b37bf194-c4e4-4228-b422-1a7b91a59ab1';
  v_product   uuid    := '38e2481f-3ba5-4a77-bbb7-3b3dec784d1f';
  v_stock_qty integer;
  v_layer_qty bigint;
begin
  select coalesce(quantity, 0) into v_stock_qty
    from public.product_stock
   where branch_id = v_branch and product_id = v_product;

  select coalesce(sum(qty_remaining), 0) into v_layer_qty
    from public.cost_layers
   where branch_id      = v_branch
     and product_id     = v_product
     and holder_user_id is null
     and qty_remaining  > 0;

  if v_layer_qty >= v_stock_qty then
    raise notice 'A4 Ogba/Ps crema pool: already covered (layers=%, stock=%), skipping.', v_layer_qty, v_stock_qty;
    return;
  end if;

  if v_stock_qty <> 12 then
    raise exception 'A4 Guard: expected stock_qty=12, got %. Stock moved since diagnosis — re-derive.', v_stock_qty;
  end if;
  if v_layer_qty <> 0 then
    raise exception 'A4 Guard: expected layer_qty=0, got %. Investigate before proceeding.', v_layer_qty;
  end if;

  insert into public.cost_layers (
    organisation_id, branch_id, holder_user_id, product_id,
    original_seq, qty_remaining, unit_cost_cents, source_ref_type, source_ref_id
  ) values (
    v_org_id, v_branch, null, v_product,
    nextval('public.cost_layer_seq'), 12, null, 'opening', null
  );

  insert into public.product_cost_state (
    organisation_id, branch_id, holder_user_id, product_id,
    quantity, avg_cost_cents, total_cost_cents
  ) values (
    v_org_id, v_branch, null, v_product,
    12, null, null
  )
  on conflict (branch_id, product_id) where holder_user_id is null
  do update set
    quantity         = 12,
    avg_cost_cents   = null,
    total_cost_cents = null,
    updated_at       = now();

  raise notice 'A4 Ogba/Ps crema pool: repaired (+12 units @ NULL cost).';
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ A5. Lekki / Ps crema (Pl oo) — holder b1b02a83, +35 units @ NULL cost
-- ╚══════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_org_id    uuid    := '2e8e7431-b526-477e-95c9-528d9a75b2b8';
  v_branch    uuid    := '47d372d2-31f8-4a2a-adda-c7f295a680ff';
  v_holder    uuid    := 'b1b02a83-86cb-47a4-84f7-bdf5a967866a';
  v_product   uuid    := '38e2481f-3ba5-4a77-bbb7-3b3dec784d1f';
  v_stock_qty integer;
  v_layer_qty bigint;
begin
  select coalesce(quantity, 0) into v_stock_qty
    from public.staff_holdings
   where branch_id      = v_branch
     and holder_user_id = v_holder
     and product_id     = v_product;

  select coalesce(sum(qty_remaining), 0) into v_layer_qty
    from public.cost_layers
   where branch_id      = v_branch
     and holder_user_id = v_holder
     and product_id     = v_product
     and qty_remaining  > 0;

  if v_layer_qty >= v_stock_qty then
    raise notice 'A5 Lekki/Ps crema holder b1b02a83: already covered (layers=%, stock=%), skipping.', v_layer_qty, v_stock_qty;
    return;
  end if;

  if v_stock_qty <> 35 then
    raise exception 'A5 Guard: expected stock_qty=35, got %. Stock moved since diagnosis — re-derive.', v_stock_qty;
  end if;
  if v_layer_qty <> 0 then
    raise exception 'A5 Guard: expected layer_qty=0, got %. Investigate before proceeding.', v_layer_qty;
  end if;

  insert into public.cost_layers (
    organisation_id, branch_id, holder_user_id, product_id,
    original_seq, qty_remaining, unit_cost_cents, source_ref_type, source_ref_id
  ) values (
    v_org_id, v_branch, v_holder, v_product,
    nextval('public.cost_layer_seq'), 35, null, 'opening', null
  );

  insert into public.product_cost_state (
    organisation_id, branch_id, holder_user_id, product_id,
    quantity, avg_cost_cents, total_cost_cents
  ) values (
    v_org_id, v_branch, v_holder, v_product,
    35, null, null
  )
  on conflict (branch_id, holder_user_id, product_id) where holder_user_id is not null
  do update set
    quantity         = 35,
    avg_cost_cents   = null,
    total_cost_cents = null,
    updated_at       = now();

  raise notice 'A5 Lekki/Ps crema holder b1b02a83: repaired (+35 units @ NULL cost).';
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ B1. HeadQuaters / Pskyn Liquer — pool, +4380 units @ 3,774,314 cents
-- ╚══════════════════════════════════════════════════════════════════════════════
-- Exact PCS read 2026-08-02: qty=330, avg=3774314, total=1245524830.
-- 4380 gap units inherit the stored avg (same avg → avg stays unchanged post-repair).
-- New PCS: qty=4710, total=17777020150 (=1245524830 + 4380×3774314), avg=3774314.
do $$
declare
  v_org_id     uuid    := '9e12840d-452d-486e-8020-e0b41e7aa9ec';
  v_branch     uuid    := 'dbd3068a-911e-41c0-8f53-84815b196c41';
  v_product    uuid    := 'bdea271e-02fa-4cb5-af13-488d94b818b4';
  v_exp_stock  integer := 4710;
  v_exp_layers integer := 330;
  v_gap        integer := 4380;
  v_exp_avg    bigint  := 3774314;
  v_exp_total  bigint  := 1245524830;
  v_new_total  bigint  := 17777020150;   -- 1245524830 + (4380 * 3774314)
  v_stock_qty  integer;
  v_layer_qty  bigint;
  v_pcs_avg    bigint;
  v_pcs_total  bigint;
  v_rows       integer;
begin
  select coalesce(quantity, 0) into v_stock_qty
    from public.product_stock
   where branch_id = v_branch and product_id = v_product;

  select coalesce(sum(qty_remaining), 0) into v_layer_qty
    from public.cost_layers
   where branch_id      = v_branch
     and product_id     = v_product
     and holder_user_id is null
     and qty_remaining  > 0;

  if v_layer_qty >= v_stock_qty then
    raise notice 'B1 HQ/Pskyn pool: already covered (layers=%, stock=%), skipping.', v_layer_qty, v_stock_qty;
    return;
  end if;

  if v_stock_qty <> v_exp_stock then
    raise exception 'B1 Guard: expected stock_qty=%, got %. Stock moved since diagnosis — re-derive.', v_exp_stock, v_stock_qty;
  end if;
  if v_layer_qty <> v_exp_layers then
    raise exception 'B1 Guard: expected layer_qty=%, got %. State changed — re-derive.', v_exp_layers, v_layer_qty;
  end if;

  select avg_cost_cents, total_cost_cents
    into v_pcs_avg, v_pcs_total
    from public.product_cost_state
   where branch_id      = v_branch
     and product_id     = v_product
     and holder_user_id is null;

  if v_pcs_avg is null or v_pcs_avg <> v_exp_avg then
    raise exception 'B1 Guard: expected avg_cost_cents=%, got %. Re-derive gap cost before applying.', v_exp_avg, v_pcs_avg;
  end if;
  if v_pcs_total is null or v_pcs_total <> v_exp_total then
    raise exception 'B1 Guard: expected total_cost_cents=%, got %. Re-derive before applying.', v_exp_total, v_pcs_total;
  end if;

  insert into public.cost_layers (
    organisation_id, branch_id, holder_user_id, product_id,
    original_seq, qty_remaining, unit_cost_cents, source_ref_type, source_ref_id
  ) values (
    v_org_id, v_branch, null, v_product,
    nextval('public.cost_layer_seq'), v_gap, v_exp_avg, 'opening', null
  );

  update public.product_cost_state
     set quantity         = v_exp_stock,
         total_cost_cents = v_new_total,
         avg_cost_cents   = v_exp_avg,    -- unchanged: adding at same avg
         updated_at       = now()
   where branch_id        = v_branch
     and product_id       = v_product
     and holder_user_id   is null;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'B1: product_cost_state UPDATE matched 0 rows — unexpected.';
  end if;

  raise notice 'B1 HQ/Pskyn pool: repaired (+% units @ % ¢). PCS qty %→%, total %→%.',
    v_gap, v_exp_avg, v_exp_layers, v_exp_stock, v_exp_total, v_new_total;
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ B2. Lekki / Ps crema (Pl oo) — pool, +147 units @ 550,000 cents
-- ╚══════════════════════════════════════════════════════════════════════════════
-- Exact PCS read 2026-08-02: qty=490, avg=550000, total=269500000.
-- New PCS: qty=637, total=350350000 (=269500000 + 147×550000), avg=550000.
do $$
declare
  v_org_id     uuid    := '2e8e7431-b526-477e-95c9-528d9a75b2b8';
  v_branch     uuid    := '47d372d2-31f8-4a2a-adda-c7f295a680ff';
  v_product    uuid    := '38e2481f-3ba5-4a77-bbb7-3b3dec784d1f';
  v_exp_stock  integer := 637;
  v_exp_layers integer := 490;
  v_gap        integer := 147;
  v_exp_avg    bigint  := 550000;
  v_exp_total  bigint  := 269500000;
  v_new_total  bigint  := 350350000;    -- 269500000 + (147 * 550000)
  v_stock_qty  integer;
  v_layer_qty  bigint;
  v_pcs_avg    bigint;
  v_pcs_total  bigint;
  v_rows       integer;
begin
  select coalesce(quantity, 0) into v_stock_qty
    from public.product_stock
   where branch_id = v_branch and product_id = v_product;

  select coalesce(sum(qty_remaining), 0) into v_layer_qty
    from public.cost_layers
   where branch_id      = v_branch
     and product_id     = v_product
     and holder_user_id is null
     and qty_remaining  > 0;

  if v_layer_qty >= v_stock_qty then
    raise notice 'B2 Lekki/Ps crema pool: already covered (layers=%, stock=%), skipping.', v_layer_qty, v_stock_qty;
    return;
  end if;

  if v_stock_qty <> v_exp_stock then
    raise exception 'B2 Guard: expected stock_qty=%, got %. Stock moved since diagnosis — re-derive.', v_exp_stock, v_stock_qty;
  end if;
  if v_layer_qty <> v_exp_layers then
    raise exception 'B2 Guard: expected layer_qty=%, got %. State changed — re-derive.', v_exp_layers, v_layer_qty;
  end if;

  select avg_cost_cents, total_cost_cents
    into v_pcs_avg, v_pcs_total
    from public.product_cost_state
   where branch_id      = v_branch
     and product_id     = v_product
     and holder_user_id is null;

  if v_pcs_avg is null or v_pcs_avg <> v_exp_avg then
    raise exception 'B2 Guard: expected avg_cost_cents=%, got %. Re-derive gap cost before applying.', v_exp_avg, v_pcs_avg;
  end if;
  if v_pcs_total is null or v_pcs_total <> v_exp_total then
    raise exception 'B2 Guard: expected total_cost_cents=%, got %. Re-derive before applying.', v_exp_total, v_pcs_total;
  end if;

  insert into public.cost_layers (
    organisation_id, branch_id, holder_user_id, product_id,
    original_seq, qty_remaining, unit_cost_cents, source_ref_type, source_ref_id
  ) values (
    v_org_id, v_branch, null, v_product,
    nextval('public.cost_layer_seq'), v_gap, v_exp_avg, 'opening', null
  );

  update public.product_cost_state
     set quantity         = v_exp_stock,
         total_cost_cents = v_new_total,
         avg_cost_cents   = v_exp_avg,
         updated_at       = now()
   where branch_id        = v_branch
     and product_id       = v_product
     and holder_user_id   is null;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'B2: product_cost_state UPDATE matched 0 rows — unexpected.';
  end if;

  raise notice 'B2 Lekki/Ps crema pool: repaired (+% units @ % ¢). PCS qty %→%, total %→%.',
    v_gap, v_exp_avg, v_exp_layers, v_exp_stock, v_exp_total, v_new_total;
end;
$$;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ B3. Lekki / Ps crema (Pl oo) — holder f374c145, +8 units @ 550,000 cents
-- ╚══════════════════════════════════════════════════════════════════════════════
-- Exact PCS read 2026-08-02: qty=10, avg=550000, total=5500000.
-- New PCS: qty=18, total=9900000 (=5500000 + 8×550000), avg=550000.
do $$
declare
  v_org_id     uuid    := '2e8e7431-b526-477e-95c9-528d9a75b2b8';
  v_branch     uuid    := '47d372d2-31f8-4a2a-adda-c7f295a680ff';
  v_holder     uuid    := 'f374c145-8736-42ef-81ab-858df2e084a6';
  v_product    uuid    := '38e2481f-3ba5-4a77-bbb7-3b3dec784d1f';
  v_exp_stock  integer := 18;
  v_exp_layers integer := 10;
  v_gap        integer := 8;
  v_exp_avg    bigint  := 550000;
  v_exp_total  bigint  := 5500000;
  v_new_total  bigint  := 9900000;    -- 5500000 + (8 * 550000)
  v_stock_qty  integer;
  v_layer_qty  bigint;
  v_pcs_avg    bigint;
  v_pcs_total  bigint;
  v_rows       integer;
begin
  select coalesce(quantity, 0) into v_stock_qty
    from public.staff_holdings
   where branch_id      = v_branch
     and holder_user_id = v_holder
     and product_id     = v_product;

  select coalesce(sum(qty_remaining), 0) into v_layer_qty
    from public.cost_layers
   where branch_id      = v_branch
     and holder_user_id = v_holder
     and product_id     = v_product
     and qty_remaining  > 0;

  if v_layer_qty >= v_stock_qty then
    raise notice 'B3 Lekki/Ps crema holder f374c145: already covered (layers=%, stock=%), skipping.', v_layer_qty, v_stock_qty;
    return;
  end if;

  if v_stock_qty <> v_exp_stock then
    raise exception 'B3 Guard: expected stock_qty=%, got %. Stock moved since diagnosis — re-derive.', v_exp_stock, v_stock_qty;
  end if;
  if v_layer_qty <> v_exp_layers then
    raise exception 'B3 Guard: expected layer_qty=%, got %. State changed — re-derive.', v_exp_layers, v_layer_qty;
  end if;

  select avg_cost_cents, total_cost_cents
    into v_pcs_avg, v_pcs_total
    from public.product_cost_state
   where branch_id      = v_branch
     and holder_user_id = v_holder
     and product_id     = v_product;

  if v_pcs_avg is null or v_pcs_avg <> v_exp_avg then
    raise exception 'B3 Guard: expected avg_cost_cents=%, got %. Re-derive gap cost before applying.', v_exp_avg, v_pcs_avg;
  end if;
  if v_pcs_total is null or v_pcs_total <> v_exp_total then
    raise exception 'B3 Guard: expected total_cost_cents=%, got %. Re-derive before applying.', v_exp_total, v_pcs_total;
  end if;

  insert into public.cost_layers (
    organisation_id, branch_id, holder_user_id, product_id,
    original_seq, qty_remaining, unit_cost_cents, source_ref_type, source_ref_id
  ) values (
    v_org_id, v_branch, v_holder, v_product,
    nextval('public.cost_layer_seq'), v_gap, v_exp_avg, 'opening', null
  );

  update public.product_cost_state
     set quantity         = v_exp_stock,
         total_cost_cents = v_new_total,
         avg_cost_cents   = v_exp_avg,
         updated_at       = now()
   where branch_id        = v_branch
     and holder_user_id   = v_holder
     and product_id       = v_product;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'B3: product_cost_state UPDATE matched 0 rows — unexpected.';
  end if;

  raise notice 'B3 Lekki/Ps crema holder f374c145: repaired (+% units @ % ¢). PCS qty %→%, total %→%.',
    v_gap, v_exp_avg, v_exp_layers, v_exp_stock, v_exp_total, v_new_total;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- Post-apply verification (run manually; all three queries must return 0 rows):
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. Pool gap check:
-- select ps.branch_id, ps.product_id, ps.quantity as stock_qty,
--        coalesce(sum(cl.qty_remaining), 0) as layer_qty
--   from public.product_stock ps
--   left join public.cost_layers cl
--     on  cl.branch_id      = ps.branch_id
--     and cl.product_id     = ps.product_id
--     and cl.holder_user_id is null
--     and cl.qty_remaining  > 0
--  where ps.quantity > 0
--  group by ps.branch_id, ps.product_id, ps.quantity
--  having ps.quantity <> coalesce(sum(cl.qty_remaining), 0);
--
-- 2. Holder gap check:
-- select sh.branch_id, sh.holder_user_id, sh.product_id, sh.quantity as stock_qty,
--        coalesce(sum(cl.qty_remaining), 0) as layer_qty
--   from public.staff_holdings sh
--   left join public.cost_layers cl
--     on  cl.branch_id      = sh.branch_id
--     and cl.holder_user_id = sh.holder_user_id
--     and cl.product_id     = sh.product_id
--     and cl.qty_remaining  > 0
--  where sh.quantity > 0
--  group by sh.branch_id, sh.holder_user_id, sh.product_id, sh.quantity
--  having sh.quantity <> coalesce(sum(cl.qty_remaining), 0);
--
-- 3. PCS / layer coherence check:
-- select pcs.branch_id, pcs.holder_user_id, pcs.product_id,
--        pcs.quantity as pcs_qty, coalesce(sum(cl.qty_remaining), 0) as layer_qty
--   from public.product_cost_state pcs
--   left join public.cost_layers cl
--     on  cl.branch_id      = pcs.branch_id
--     and cl.product_id     = pcs.product_id
--     and cl.holder_user_id is not distinct from pcs.holder_user_id
--     and cl.qty_remaining  > 0
--  where pcs.quantity > 0
--  group by pcs.branch_id, pcs.holder_user_id, pcs.product_id, pcs.quantity
--  having pcs.quantity <> coalesce(sum(cl.qty_remaining), 0);
