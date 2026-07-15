-- ─────────────────────────────────────────────────────────────────────────────
-- app_0024_sales.sql
--
-- Introduces the sales feature. A sale draws from the SELLER'S personal holding
-- (staff_holdings), not branch stock. You can only sell what you personally hold.
--
-- Tables:  sales, sale_lines
-- Column:  products.default_price_cents (new, nullable)
-- Helper:  user_readable_sale_ids()
-- RPC:     record_sale()
--
-- Design rules enforced here:
--   - sales and sale_lines are immutable (no updated_at, no deleted_at, no user
--     write policies). A mistake is corrected by a future reversal entry, never
--     by editing the original row.
--   - unit_price_cents is CAPTURED at time of sale on the line. It is not a
--     foreign key or lookup; the price snapshot lives with the line forever.
--   - line_total_cents = quantity * unit_price_cents is enforced as a DB check
--     so the total can never drift from the arithmetic.
--   - Every stock_ledger row written by record_sale has holder_user_id = seller
--     (v_user_id). The live stock_ledger_holder_consistency constraint requires
--     this for reason = 'sale'. The RPC is the only writer of 'sale' rows.
--   - FOR UPDATE on the staff_holdings row serialises concurrent sales of the
--     same product by the same seller (same race-prevention pattern as
--     review_stock_request's FOR UPDATE on product_stock).
--   - All writes within record_sale execute in a single transaction. A partial
--     failure rolls everything back: no orphaned sale header, no half-decremented
--     holding.
--
-- Depends on: app_0001_core (organisations, branches)
--             app_0006_products (products — for default_price_cents column)
--             app_0009_vendors_rls (user_vendor_read/write_branch_ids helpers)
--             app_0021_ledger_holder (holder_user_id column + 'sale' reason value)
--             app_0022_staff_holdings (staff_holdings table)
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Add default selling price to products ──────────────────────────────────
--
-- Nullable — no product is required to have a price. When set, record_sale
-- pre-fills the line at this price; the seller can override per line.
-- Stored as bigint cents (NGN 1,000 = 100000) consistent with all money columns.

alter table public.products
  add column default_price_cents bigint
  check (default_price_cents is null or default_price_cents >= 0);


-- ── 2. sales table (header) ───────────────────────────────────────────────────
--
-- One row per sale event. total_cents is set to 0 at insert, then updated
-- to the summed line totals at the end of record_sale. The two-phase write is
-- necessary because line totals aren't known until the loop completes.
--
-- Immutable after creation: no updated_at trigger, no deleted_at. Corrections
-- are handled by a future reversal/credit-note mechanism, not in-place edits.

create table public.sales (
  id               uuid        primary key default gen_random_uuid(),
  organisation_id  uuid        not null references public.organisations(id) on delete restrict,
  branch_id        uuid        not null references public.branches(id)       on delete restrict,
  seller_user_id   uuid        not null references auth.users(id),
  customer_name    text,
  customer_phone   text,
  sold_on          date        not null default current_date,
  total_cents      bigint      not null default 0 check (total_cents >= 0),
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid        references auth.users(id)
  -- No updated_at — immutable after creation.
  -- No deleted_at — corrections via future reversal, never soft-delete.
);

-- Filter by date range within a branch (primary reporting query).
create index sales_branch_date_idx
  on public.sales (branch_id, sold_on);

-- Seller's own sale history (used by the RLS SELECT policy path).
create index sales_seller_idx
  on public.sales (seller_user_id);

-- Owner/inventory: all sales by a specific seller in a branch.
create index sales_branch_seller_idx
  on public.sales (branch_id, seller_user_id);


-- ── 3. sale_lines ─────────────────────────────────────────────────────────────
--
-- One row per product per sale. Price is captured at time of sale —
-- changing a product's default_price_cents later does not affect past lines.

create table public.sale_lines (
  id               uuid    primary key default gen_random_uuid(),
  sale_id          uuid    not null references public.sales(id) on delete cascade,
  product_id       uuid    not null references public.products(id) on delete restrict,
  quantity         integer not null check (quantity > 0),
  unit_price_cents bigint  not null check (unit_price_cents >= 0),
  line_total_cents bigint  not null check (line_total_cents = quantity * unit_price_cents)
);

create index sale_lines_sale_idx
  on public.sale_lines (sale_id);


-- ── 4. RLS ────────────────────────────────────────────────────────────────────

alter table public.sales      enable row level security;
alter table public.sale_lines enable row level security;

-- Helper: returns IDs of sales the current user may read.
-- Mirrors user_readable_request_ids() (app_0016):
--   - Sellers read their own sales (seller_user_id = auth.uid()).
--   - Owners and inventory members read all sales in branches they manage.
-- Using a security-definer helper avoids querying an RLS-protected table
-- (sales) from inside sale_lines' policy — the same RLS-on-RLS pattern
-- prevented throughout this schema.
create or replace function public.user_readable_sale_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
  from public.sales
  where seller_user_id = auth.uid()
     or branch_id in (select public.user_vendor_write_branch_ids());
$$;

revoke all    on function public.user_readable_sale_ids from public;
grant execute on function public.user_readable_sale_ids to authenticated;

-- sales: SELECT
-- Sellers see their own sales; owners and inventory see all in their branches.
create policy "read own sales or as owner/inventory"
  on public.sales
  for select
  using (
    seller_user_id = auth.uid()
    or branch_id in (select public.user_vendor_write_branch_ids())
  );

-- sales: no INSERT / UPDATE / DELETE user policies — RPC only.

-- sale_lines: SELECT via helper (avoids RLS-on-RLS).
create policy "read sale_lines via parent sale"
  on public.sale_lines
  for select
  using (
    sale_id in (select public.user_readable_sale_ids())
  );

-- sale_lines: no INSERT / UPDATE / DELETE user policies — RPC only.


-- ── 5. record_sale RPC ────────────────────────────────────────────────────────
--
-- Records a sale drawn from the calling user's personal holding.
-- Returns the new sale id (uuid) so the caller can redirect to a receipt view.
--
-- The seller (v_user_id = auth.uid()) is both the holder whose stock decrements
-- and the created_by on all written rows.
--
-- Per-line sequence (inside the loop, same transaction):
--   1. Validate quantity and price.
--   2. Confirm the product belongs to this org.
--   3. SELECT ... FOR UPDATE on staff_holdings — locks the holding row and reads
--      the current quantity. If no holding row exists (never issued), v_held
--      remains NULL; coalesce(v_held, 0) causes the guard to fail immediately.
--   4. Holding guard: raise if held < selling quantity.
--   5. Insert sale_line.
--   6. Accumulate v_total.
--   7. Insert stock_ledger row (reason = 'sale', holder_user_id = v_user_id).
--      This satisfies the live stock_ledger_holder_consistency constraint.
--   8. Decrement staff_holdings. The guard (step 4) guarantees this cannot
--      push quantity below zero; the check (quantity >= 0) is a backstop.
--
-- After the loop: update sales.total_cents with the accumulated total.

create or replace function public.record_sale(
  p_branch_id      uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_sold_on        date,
  p_note           text,
  p_lines          jsonb   -- array of { product_id, quantity, unit_price_cents }
) returns uuid             -- the new sale id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_org_id     uuid;
  v_sale_id    uuid;
  v_line       jsonb;
  v_product_id uuid;
  v_qty        integer;
  v_price      bigint;
  v_held       integer;
  v_total      bigint := 0;
begin
  -- ── Auth guard ───────────────────────────────────────────────────────────────
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- ── Resolve and validate branch ───────────────────────────────────────────────
  select organisation_id into v_org_id
    from public.branches
   where id = p_branch_id
     and deleted_at is null;

  if v_org_id is null then
    raise exception 'branch not found';
  end if;

  -- ── Membership gate ───────────────────────────────────────────────────────────
  -- Permission to sell is "do you hold enough" (checked per line below).
  -- This gate only verifies the caller is a member of this branch at all —
  -- a user from a different org cannot record a sale in this branch even if
  -- they somehow constructed a valid branch_id.
  if p_branch_id not in (select public.user_vendor_read_branch_ids()) then
    raise exception 'not authorised to record sales in this branch';
  end if;

  -- ── Lines required ────────────────────────────────────────────────────────────
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a sale must have at least one line';
  end if;

  -- ── Insert sale header (total filled after lines) ─────────────────────────────
  -- total_cents starts at 0 and is updated to the real sum at the end.
  insert into public.sales (
    organisation_id,
    branch_id,
    seller_user_id,
    customer_name,
    customer_phone,
    sold_on,
    total_cents,
    note,
    created_by
  ) values (
    v_org_id,
    p_branch_id,
    v_user_id,
    nullif(trim(p_customer_name),  ''),
    nullif(trim(p_customer_phone), ''),
    coalesce(p_sold_on, current_date),
    0,
    nullif(trim(p_note), ''),
    v_user_id
  )
  returning id into v_sale_id;

  -- ── Process each line ─────────────────────────────────────────────────────────
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty        := (v_line->>'quantity')::integer;
    v_price      := (v_line->>'unit_price_cents')::bigint;

    -- ── Validate inputs ───────────────────────────────────────────────────────
    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be greater than 0';
    end if;

    if v_price is null or v_price < 0 then
      raise exception 'unit price must be 0 or greater';
    end if;

    -- ── Product must belong to this org ───────────────────────────────────────
    if not exists (
      select 1
        from public.products
       where id              = v_product_id
         and organisation_id = v_org_id
         and deleted_at      is null
    ) then
      raise exception 'product % not found in this organisation', v_product_id;
    end if;

    -- ── HOLDING GUARD ─────────────────────────────────────────────────────────
    -- FOR UPDATE locks this (branch, holder, product) row for the duration of
    -- the transaction. A concurrent sale of the same product by the same seller
    -- blocks here until this transaction commits, then re-reads the decremented
    -- quantity — correctly failing the guard if holding ran out.
    --
    -- If the seller has never held this product (no row exists), the SELECT INTO
    -- sets v_held to NULL. coalesce(v_held, 0) then evaluates to 0, which is
    -- less than any positive v_qty — the guard raises immediately.
    select coalesce(quantity, 0) into v_held
      from public.staff_holdings
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id
     for update;

    if coalesce(v_held, 0) < v_qty then
      raise exception
        'insufficient holding for product % (holding: %, selling: %)',
        v_product_id, coalesce(v_held, 0), v_qty;
    end if;

    -- ── Insert sale line ──────────────────────────────────────────────────────
    -- unit_price_cents is captured here — it is not looked up from products.
    -- Historical price is preserved even if default_price_cents changes later.
    insert into public.sale_lines (
      sale_id,
      product_id,
      quantity,
      unit_price_cents,
      line_total_cents
    ) values (
      v_sale_id,
      v_product_id,
      v_qty,
      v_price,
      v_qty * v_price
    );

    v_total := v_total + (v_qty * v_price);

    -- ── Ledger: sale OUT of holding ───────────────────────────────────────────
    -- reason = 'sale', holder_user_id = v_user_id (the seller).
    -- The live stock_ledger_holder_consistency constraint REQUIRES holder_user_id
    -- to be non-null for reason = 'sale'. This insert always provides it.
    insert into public.stock_ledger (
      organisation_id,
      branch_id,
      product_id,
      quantity_delta,
      reason,
      reference_type,
      reference_id,
      holder_user_id,
      created_by
    ) values (
      v_org_id,
      p_branch_id,
      v_product_id,
      -v_qty,        -- stock leaves the holder's possession
      'sale',
      'sale',
      v_sale_id,
      v_user_id,     -- the seller IS the holder
      v_user_id
    );

    -- ── Decrement staff_holdings ──────────────────────────────────────────────
    -- The holding guard above confirmed quantity >= v_qty, so this cannot push
    -- quantity below zero. The check (quantity >= 0) on staff_holdings is a
    -- database-layer backstop for any future code path.
    update public.staff_holdings
       set quantity   = quantity - v_qty,
           updated_at = now()
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id;

  end loop;

  -- ── Update sale header with real total ────────────────────────────────────────
  update public.sales
     set total_cents = v_total
   where id = v_sale_id;

  return v_sale_id;
end;
$$;

revoke all    on function public.record_sale(uuid, text, text, date, text, jsonb) from public;
grant execute on function public.record_sale(uuid, text, text, date, text, jsonb) to authenticated;
