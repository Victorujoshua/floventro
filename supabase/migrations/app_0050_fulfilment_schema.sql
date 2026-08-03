-- ─────────────────────────────────────────────────────────────────────────────
-- app_0050_fulfilment_schema.sql
--
-- Introduces Fulfilment: distributor/wholesale orders drawn from BRANCH POOL
-- stock (product_stock), NOT staff personal holdings.
--
-- Lifecycle:  pending → packed → shipped → delivered  (+ cancelled at any
--             non-terminal stage, with restrictions per phase)
-- Pattern:    mirrors stock_transfers — multi-actor, RPC-per-transition,
--             per-actor timestamps. All mutations via security-definer RPCs.
--
-- ══════════════════════════════════════════════════════════════════════════════
-- PHASE 1a — schema + lifecycle + UI only.
-- Stock movement and COGS are NOT wired here.
-- pack_fulfilment_order is a STATUS-ONLY STUB. app_0051 adds the pool drain.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Tables:    fulfilment_orders, fulfilment_lines
-- Modified:  cogs_allocations.reference_type check (adds 'fulfilment_line'
--            so app_0051 can write COGS rows without another migration)
-- Helper:    user_readable_fulfilment_ids()
-- RPCs:      create_fulfilment_order, pack_fulfilment_order (stub),
--            ship_fulfilment_order, deliver_fulfilment_order,
--            cancel_fulfilment_order (pending only)
--
-- Depends on:
--   app_0001_core         (set_updated_at fn, organisations, branches)
--   app_0006_products     (products table)
--   app_0009_vendors_rls  (user_vendor_read_branch_ids, user_vendor_write_branch_ids)
--   app_0046_admin_role   (admin included in user_vendor_write_branch_ids)
--   app_0033_costing_schema (cogs_allocations)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. fulfilment_orders (header)
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Unlike sales (immutable), orders are MUTABLE: status transitions are recorded
-- in-place. updated_at tracks the last mutation; deleted_at enables soft-delete.

create table public.fulfilment_orders (
  id                uuid        primary key default gen_random_uuid(),
  organisation_id   uuid        not null references public.organisations(id) on delete restrict,
  branch_id         uuid        not null references public.branches(id)      on delete restrict,

  -- Lifecycle status.
  -- Valid transitions (all enforced by RPCs):
  --   pending → packed     (Phase 1a stub: no stock movement)
  --   packed  → shipped
  --   shipped → delivered
  --   pending → cancelled  (Phase 1a)
  --   packed+ → cancelled  (Phase 1b: requires stock return)
  status            text        not null default 'pending'
                                check (status in ('pending','packed','shipped','delivered','cancelled')),

  -- Distributor / buyer — freeform, no distributors entity (mirrors customer_name on sales).
  distributor_name  text        not null,
  distributor_phone text,
  distributor_email text,

  -- Financials. total_cents computed from lines in create_fulfilment_order.
  total_cents       bigint      not null default 0   check (total_cents >= 0),
  payment_method    text        check (payment_method in ('cash','pos','bank_transfer','cheque','other')),
  payment_status    text        not null default 'unpaid'
                                check (payment_status in ('unpaid','partial','paid')),
  amount_paid_cents bigint      not null default 0   check (amount_paid_cents >= 0),

  note              text,

  -- Per-actor lifecycle fields (mirrors stock_transfers pattern).
  requested_by      uuid        not null references auth.users(id),
  packed_by         uuid                 references auth.users(id),
  shipped_by        uuid                 references auth.users(id),
  delivered_by      uuid                 references auth.users(id),
  cancelled_by      uuid                 references auth.users(id),

  packed_at         timestamptz,
  shipped_at        timestamptz,
  delivered_at      timestamptz,
  cancelled_at      timestamptz,

  deleted_at        timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Reuse the existing set_updated_at() trigger function from app_0001_core.sql.
create trigger fulfilment_orders_updated_at
  before update on public.fulfilment_orders
  for each row execute function public.set_updated_at();

create index fulfilment_orders_branch_status_idx
  on public.fulfilment_orders (branch_id, status)
  where deleted_at is null;

create index fulfilment_orders_org_idx
  on public.fulfilment_orders (organisation_id)
  where deleted_at is null;

create index fulfilment_orders_requested_by_idx
  on public.fulfilment_orders (requested_by);


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. fulfilment_lines
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.fulfilment_lines (
  id               uuid    primary key default gen_random_uuid(),
  order_id         uuid    not null references public.fulfilment_orders(id) on delete cascade,
  product_id       uuid    not null references public.products(id)          on delete restrict,
  quantity         integer not null check (quantity > 0),
  unit_price_cents bigint  not null check (unit_price_cents >= 0),
  line_total_cents bigint  not null check (line_total_cents = quantity * unit_price_cents)
  -- app_0051 adds COGS freeze via cogs_allocations — no columns added here.
);

create index fulfilment_lines_order_idx
  on public.fulfilment_lines (order_id);


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 3. cogs_allocations.reference_type — add 'fulfilment_line'
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Forward-compatible schema change. No data written in Phase 1a; this prepares
-- the table so Phase 1b can INSERT cogs rows without a separate migration.
--
-- The constraint was created inline in app_0033_costing_schema.sql.
-- PostgreSQL auto-names it 'cogs_allocations_reference_type_check'.
-- Verify on live DB if needed:
--   select conname from pg_constraint
--    where conrelid = 'public.cogs_allocations'::regclass
--      and contype = 'c' and conname like '%reference_type%';

alter table public.cogs_allocations
  drop constraint cogs_allocations_reference_type_check;

alter table public.cogs_allocations
  add constraint cogs_allocations_reference_type_check
  check (reference_type in ('sale_line', 'service_consumption', 'fulfilment_line'));


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 4. user_readable_fulfilment_ids() — security-definer helper
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Returns IDs of fulfilment_orders visible to the caller.
-- Mirrors user_readable_sale_ids() (app_0024):
--   • sales / internal_use → orders they requested (requested_by = uid)
--   • owner / admin / inventory → all non-deleted orders in their managed branches
--
-- Defined before fulfilment_lines RLS policy to avoid RLS-on-RLS recursion.

create or replace function public.user_readable_fulfilment_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
    from public.fulfilment_orders
   where deleted_at is null
     and (
           requested_by = auth.uid()
        or branch_id in (select public.user_vendor_write_branch_ids())
     );
$$;

revoke all    on function public.user_readable_fulfilment_ids() from public;
grant execute on function public.user_readable_fulfilment_ids() to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 5. RLS — fulfilment_orders
-- ╚══════════════════════════════════════════════════════════════════════════════

alter table public.fulfilment_orders enable row level security;
alter table public.fulfilment_orders force row level security;

-- Mirrors "read own sales or as owner/inventory" policy on sales table.
create policy "fulfilment_orders: read own or as manager"
  on public.fulfilment_orders
  for select
  using (
    deleted_at is null
    and (
      requested_by = auth.uid()
      or branch_id in (select public.user_vendor_write_branch_ids())
    )
  );

-- No INSERT / UPDATE / DELETE — all writes via security-definer RPCs only.


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 6. RLS — fulfilment_lines
-- ╚══════════════════════════════════════════════════════════════════════════════

alter table public.fulfilment_lines enable row level security;
alter table public.fulfilment_lines force row level security;

-- Lines visible iff parent order is visible.
-- security-definer helper avoids RLS-on-RLS recursion.
create policy "fulfilment_lines: visible with parent order"
  on public.fulfilment_lines
  for select
  using (order_id in (select public.user_readable_fulfilment_ids()));

-- No INSERT / UPDATE / DELETE — all writes via security-definer RPCs only.


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 7. Table grants
-- ╚══════════════════════════════════════════════════════════════════════════════

revoke all on table public.fulfilment_orders from public;
revoke all on table public.fulfilment_lines  from public;

grant select on table public.fulfilment_orders to authenticated;
grant select on table public.fulfilment_lines  to authenticated;
-- No insert/update/delete grants — mutations via RPCs only.


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 8. create_fulfilment_order RPC
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Creates a new order in 'pending' status + its lines.
-- Callable by: sales, owner, admin, inventory members of the branch.
-- NOT callable by: internal_use (their workflow is service consumption).
-- Returns: new order id (uuid).

create or replace function public.create_fulfilment_order(
  p_branch_id          uuid,
  p_distributor_name   text,
  p_distributor_phone  text,
  p_distributor_email  text,
  p_note               text,
  p_payment_method     text,   -- 'cash'|'pos'|'bank_transfer'|'cheque'|'other'|null
  p_payment_status     text,   -- 'paid'|'unpaid'
  p_lines              jsonb   -- [{ product_id, quantity, unit_price_cents }]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid   := auth.uid();
  v_org_id      uuid;
  v_caller_role text;
  v_order_id    uuid;
  v_line        jsonb;
  v_product_id  uuid;
  v_qty         integer;
  v_price       bigint;
  v_line_total  bigint;
  v_total       bigint := 0;
begin
  -- ── Auth ─────────────────────────────────────────────────────────────────────
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- ── Resolve branch ────────────────────────────────────────────────────────────
  select organisation_id into v_org_id
    from public.branches
   where id = p_branch_id and deleted_at is null;

  if v_org_id is null then
    raise exception 'branch not found';
  end if;

  -- ── Role-based access guard ───────────────────────────────────────────────────
  -- Resolve caller's membership role for this branch.
  -- Sales, admin, and inventory members have a direct row with branch_id = p_branch_id.
  select role into v_caller_role
    from public.memberships
   where user_id   = v_user_id
     and branch_id = p_branch_id
     and deleted_at is null
   limit 1;

  -- Owners have branch_id IS NULL in memberships (they span all branches in the org).
  -- If no direct branch row was found, check for an org-level owner membership.
  if v_caller_role is null then
    select 'owner' into v_caller_role
      from public.memberships
     where user_id         = v_user_id
       and role            = 'owner'
       and organisation_id = v_org_id
       and branch_id       is null
       and deleted_at      is null
     limit 1;
  end if;

  -- Only sales + management roles may create fulfilment orders.
  -- internal_use is explicitly excluded: their outflow is service consumption, not wholesale orders.
  if v_caller_role is null or v_caller_role not in ('sales', 'owner', 'admin', 'inventory') then
    raise exception 'not authorised to create fulfilment orders';
  end if;

  -- ── Input validation ──────────────────────────────────────────────────────────
  if p_distributor_name is null or trim(p_distributor_name) = '' then
    raise exception 'distributor name is required';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'order must have at least one line';
  end if;

  if coalesce(p_payment_status, '') not in ('paid', 'unpaid') then
    raise exception 'payment_status must be paid or unpaid';
  end if;

  -- ── Insert header (total_cents=0 placeholder; updated after loop) ─────────────
  insert into public.fulfilment_orders (
    organisation_id, branch_id, status,
    distributor_name, distributor_phone, distributor_email,
    note, payment_method, payment_status, amount_paid_cents,
    total_cents, requested_by
  ) values (
    v_org_id, p_branch_id, 'pending',
    trim(p_distributor_name),
    nullif(trim(coalesce(p_distributor_phone, '')), ''),
    nullif(trim(coalesce(p_distributor_email, '')), ''),
    nullif(trim(coalesce(p_note, '')),              ''),
    nullif(p_payment_method, ''),
    p_payment_status,
    0,   -- amount_paid: Phase 1a tracks simple paid/unpaid; set after total known
    0,
    v_user_id
  )
  returning id into v_order_id;

  -- ── Process lines ────────────────────────────────────────────────────────────
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty        := (v_line->>'quantity')::integer;
    v_price      := (v_line->>'unit_price_cents')::bigint;

    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be greater than 0';
    end if;

    if v_price is null or v_price < 0 then
      raise exception 'unit_price_cents must be 0 or more';
    end if;

    if not exists (
      select 1 from public.products
       where id = v_product_id and organisation_id = v_org_id and deleted_at is null
    ) then
      raise exception 'product % not found in this organisation', v_product_id;
    end if;

    v_line_total := v_qty * v_price;

    insert into public.fulfilment_lines (
      order_id, product_id, quantity, unit_price_cents, line_total_cents
    ) values (
      v_order_id, v_product_id, v_qty, v_price, v_line_total
    );

    v_total := v_total + v_line_total;
  end loop;

  -- ── Update header total + resolve amount_paid ─────────────────────────────────
  update public.fulfilment_orders
     set total_cents       = v_total,
         amount_paid_cents = case when p_payment_status = 'paid' then v_total else 0 end
   where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all    on function public.create_fulfilment_order(uuid,text,text,text,text,text,text,jsonb) from public;
grant execute on function public.create_fulfilment_order(uuid,text,text,text,text,text,text,jsonb) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 9. pack_fulfilment_order  ─── PHASE 1a STATUS-ONLY STUB ───
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Transitions: pending → packed.
-- Callable by: owner / admin / inventory of the branch.
--
-- ████████████████████████████████████████████████████████████████████████████
-- PHASE 1a — NO STOCK MOVEMENT, NO COGS FREEZE.
-- app_0051 will replace this with the full pool drain:
--   1. FOR UPDATE on product_stock per line  (race-prevention lock)
--   2. Pool stock guard (quantity >= line qty)
--   3. stock_ledger INSERT per line:
--        reason='fulfilment_out', holder_user_id=NULL, quantity_delta=-qty
--   4. product_stock DECREMENT per line
--   5. FOR UPDATE on product_cost_state (pool bucket: holder_user_id IS NULL)
--   6. FIFO: drain_fifo_layers(org, branch, NULL, product, qty) → v_cogs
--      WEIGHTED: v_cogs = qty × pool_avg
--   7. cogs_allocations INSERT per line:
--        reference_type='fulfilment_line', reference_id=fulfilment_line.id
--   8. product_cost_state DECREMENT (pool bucket)
-- ████████████████████████████████████████████████████████████████████████████
--
-- Returns: 'packed'

create or replace function public.pack_fulfilment_order(
  p_order_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order   public.fulfilment_orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_order
    from public.fulfilment_orders
   where id = p_order_id and deleted_at is null;

  if v_order.id is null then
    raise exception 'order not found';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'only pending orders can be packed (current status: %)', v_order.status;
  end if;

  if v_order.branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to pack orders for this branch';
  end if;

  -- ── app_0051: stock drain + COGS freeze replaces this comment ────────────────

  update public.fulfilment_orders
     set status    = 'packed',
         packed_by = v_user_id,
         packed_at = now()
   where id = p_order_id;

  return 'packed';
end;
$$;

revoke all    on function public.pack_fulfilment_order(uuid) from public;
grant execute on function public.pack_fulfilment_order(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 10. ship_fulfilment_order
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Transitions: packed → shipped.
-- Guard: status must be 'packed'.
-- Callable by: owner / admin / inventory.
-- Returns: 'shipped'

create or replace function public.ship_fulfilment_order(
  p_order_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order   public.fulfilment_orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_order
    from public.fulfilment_orders
   where id = p_order_id and deleted_at is null;

  if v_order.id is null then
    raise exception 'order not found';
  end if;

  if v_order.status <> 'packed' then
    raise exception 'only packed orders can be shipped (current status: %)', v_order.status;
  end if;

  if v_order.branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to ship orders for this branch';
  end if;

  update public.fulfilment_orders
     set status     = 'shipped',
         shipped_by = v_user_id,
         shipped_at = now()
   where id = p_order_id;

  return 'shipped';
end;
$$;

revoke all    on function public.ship_fulfilment_order(uuid) from public;
grant execute on function public.ship_fulfilment_order(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 11. deliver_fulfilment_order
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Transitions: shipped → delivered.
-- Guard: status must be 'shipped'.
-- Callable by: owner / admin / inventory.
-- Returns: 'delivered'

create or replace function public.deliver_fulfilment_order(
  p_order_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order   public.fulfilment_orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_order
    from public.fulfilment_orders
   where id = p_order_id and deleted_at is null;

  if v_order.id is null then
    raise exception 'order not found';
  end if;

  if v_order.status <> 'shipped' then
    raise exception 'only shipped orders can be delivered (current status: %)', v_order.status;
  end if;

  if v_order.branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to deliver orders for this branch';
  end if;

  update public.fulfilment_orders
     set status       = 'delivered',
         delivered_by = v_user_id,
         delivered_at = now()
   where id = p_order_id;

  return 'delivered';
end;
$$;

revoke all    on function public.deliver_fulfilment_order(uuid) from public;
grant execute on function public.deliver_fulfilment_order(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 12. cancel_fulfilment_order
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Phase 1a: cancels PENDING orders only (no stock has moved).
-- app_0051 extends this to support cancelling packed orders with stock return.
--
-- Callable by:
--   • The order requester (own pending order)
--   • owner / admin / inventory of the branch
--
-- Returns: 'cancelled'

create or replace function public.cancel_fulfilment_order(
  p_order_id uuid,
  p_note     text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order   public.fulfilment_orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_order
    from public.fulfilment_orders
   where id = p_order_id and deleted_at is null;

  if v_order.id is null then
    raise exception 'order not found';
  end if;

  -- Phase 1a: only pending orders (no stock moved yet).
  -- app_0051 will extend this to support cancelling packed orders with stock return.
  if v_order.status <> 'pending' then
    raise exception 'only pending orders can be cancelled in Phase 1a (current status: %)', v_order.status;
  end if;

  -- Requester can cancel their own; managers can cancel any in their branch.
  if v_order.requested_by <> v_user_id
     and v_order.branch_id not in (select public.user_vendor_write_branch_ids())
  then
    raise exception 'not authorised to cancel this order';
  end if;

  update public.fulfilment_orders
     set status       = 'cancelled',
         cancelled_by = v_user_id,
         cancelled_at = now(),
         note         = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
   where id = p_order_id;

  return 'cancelled';
end;
$$;

revoke all    on function public.cancel_fulfilment_order(uuid, text) from public;
grant execute on function public.cancel_fulfilment_order(uuid, text) to authenticated;
