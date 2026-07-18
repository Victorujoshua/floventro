-- ─────────────────────────────────────────────────────────────────────────────
-- app_0028_transfers.sql
--
-- Introduces inter-branch stock transfers (same organisation only).
-- Two-stage flow:
--   1. initiate_transfer — owner/inventory of SOURCE branch sends stock.
--      Stock leaves source product_stock immediately (it is "in transit").
--   2. receive_transfer  — owner/inventory of DESTINATION branch records
--      actual quantities received. Partial receipt is allowed; the shortfall
--      (quantity_sent − quantity_received) is stock that left the source but
--      never arrived — visible as a discrepancy on the transfer lines.
--
-- Ledger shape (both legs are branch movements: holder_user_id = NULL):
--   transfer_out  −n  source branch   (already in stock_ledger_reason_check
--   transfer_in   +m  dest branch      from app_0010; no constraint change)
--
-- Tables:
--   stock_transfers      — one row per transfer event (header)
--   stock_transfer_lines — one row per product line
--
-- Helper:
--   user_readable_transfer_ids() — security-definer, mirrors
--   user_readable_sale_ids() / user_readable_service_ids()
--
-- RPCs:
--   initiate_transfer(uuid, uuid, text, jsonb) → uuid
--   receive_transfer(uuid, jsonb, text)        → text
--
-- Shortfall note:
--   If quantity_received < quantity_sent, the difference is stock that left
--   the source branch but was not received at the destination (damaged in
--   transit, delivery error, etc.). It is NOT credited to any branch and
--   NOT written as an additional ledger row. The discrepancy is visible by
--   comparing the two quantity columns on the transfer line.
--
-- Depends on: app_0001_core   (organisations, branches)
--             app_0006_products (products)
--             app_0009_vendors_rls (user_vendor_read/write_branch_ids)
--             app_0010_stock  (product_stock, stock_ledger, transfer_* reasons)
--             app_0011_stock_rls (stock_ledger RLS helpers)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. stock_transfers (header)
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.stock_transfers (
  id               uuid        primary key default gen_random_uuid(),
  organisation_id  uuid        not null references public.organisations(id) on delete restrict,
  source_branch_id uuid        not null references public.branches(id)      on delete restrict,
  dest_branch_id   uuid        not null references public.branches(id)      on delete restrict,
  status           text        not null default 'in_transit'
                               check (status in ('in_transit', 'received', 'cancelled')),
  initiated_by     uuid        not null references auth.users(id),
  received_by      uuid                 references auth.users(id),
  cancelled_by     uuid                 references auth.users(id),
  initiated_at     timestamptz not null default now(),
  received_at      timestamptz,
  cancelled_at     timestamptz,
  note             text,
  created_at       timestamptz not null default now(),

  -- A branch cannot transfer stock to itself.
  constraint stock_transfers_diff_branches check (source_branch_id <> dest_branch_id)
);

-- Queries by source (inventory manager reviewing outgoing transfers)
create index stock_transfers_source_status_idx
  on public.stock_transfers (source_branch_id, status);

-- Queries by destination (receiver reviewing incoming transfers)
create index stock_transfers_dest_status_idx
  on public.stock_transfers (dest_branch_id, status);

-- Org-level reporting
create index stock_transfers_org_status_idx
  on public.stock_transfers (organisation_id, status);


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. stock_transfer_lines
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.stock_transfer_lines (
  id                uuid    primary key default gen_random_uuid(),
  transfer_id       uuid    not null references public.stock_transfers(id) on delete cascade,
  product_id        uuid    not null references public.products(id)        on delete restrict,
  quantity_sent     integer not null check (quantity_sent > 0),
  -- Null until receive_transfer records actual receipt.
  -- May be < quantity_sent (shortfall) or = quantity_sent (full receipt).
  -- Cannot exceed quantity_sent — you cannot receive more than was sent.
  quantity_received integer
    check (
      quantity_received is null
      or (quantity_received >= 0 and quantity_received <= quantity_sent)
    )
);

create index stock_transfer_lines_transfer_idx
  on public.stock_transfer_lines (transfer_id);


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 3. user_readable_transfer_ids() security-definer helper
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Returns the IDs of stock_transfers the caller is allowed to read.
-- A user may read a transfer if they have member-level (read) access to EITHER
-- the source branch OR the destination branch.
--
-- Defined before the RLS policy on stock_transfer_lines so that policy can
-- reference it. Queries stock_transfers as security definer (bypasses RLS
-- internally) and returns only the IDs appropriate for the caller —
-- the same pattern as user_readable_sale_ids() and user_readable_service_ids().

create or replace function public.user_readable_transfer_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
    from public.stock_transfers
   where source_branch_id in (select public.user_vendor_read_branch_ids())
      or dest_branch_id   in (select public.user_vendor_read_branch_ids());
$$;

revoke all    on function public.user_readable_transfer_ids() from public;
grant execute on function public.user_readable_transfer_ids() to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 4. RLS — stock_transfers
-- ╚══════════════════════════════════════════════════════════════════════════════

alter table public.stock_transfers enable row level security;
alter table public.stock_transfers force row level security;

-- Any member of the source OR destination branch may read the transfer.
-- This lets the sending team track outgoing and the receiving team track
-- incoming, without needing access to the other branch for anything else.
create policy "stock_transfers: read if member of either branch"
  on public.stock_transfers
  for select
  using (
    source_branch_id in (select public.user_vendor_read_branch_ids())
    or dest_branch_id in (select public.user_vendor_read_branch_ids())
  );

-- No INSERT / UPDATE / DELETE policies — all writes go through the
-- initiate_transfer and receive_transfer security-definer RPCs.


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 5. RLS — stock_transfer_lines
-- ╚══════════════════════════════════════════════════════════════════════════════

alter table public.stock_transfer_lines enable row level security;
alter table public.stock_transfer_lines force row level security;

-- Lines are visible if and only if the parent transfer is visible.
-- Using user_readable_transfer_ids() avoids joining through stock_transfers
-- under its own RLS policy, which would trigger RLS-on-RLS recursion.
create policy "stock_transfer_lines: visible with parent transfer"
  on public.stock_transfer_lines
  for select
  using (transfer_id in (select public.user_readable_transfer_ids()));

-- No INSERT / UPDATE / DELETE policies — all writes via RPCs only.


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 6. Table grants
-- ╚══════════════════════════════════════════════════════════════════════════════

revoke all on table public.stock_transfers      from public;
revoke all on table public.stock_transfer_lines from public;

grant select on table public.stock_transfers      to authenticated;
grant select on table public.stock_transfer_lines to authenticated;
-- No insert/update/delete grants — mutations are via RPCs only.


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 7. initiate_transfer RPC
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Called by owner/inventory of the SOURCE branch. Immediately:
--   • Validates both branches exist and are in the same organisation.
--   • Checks the caller has WRITE access to the source branch.
--   • FOR UPDATE on product_stock to serialise concurrent initiations.
--   • Writes stock_ledger transfer_out (−qty, holder NULL) at source.
--   • Decrements source product_stock (stock is now "in transit").
--   • Creates stock_transfers header + one stock_transfer_lines row per line.
--
-- Returns: the new transfer id (uuid).

create or replace function public.initiate_transfer(
  p_source_branch_id uuid,
  p_dest_branch_id   uuid,
  p_note             text,
  p_lines            jsonb   -- array of { product_id, quantity }
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_org_id     uuid;
  v_dest_org   uuid;
  v_transfer_id uuid;
  v_line       jsonb;
  v_product_id uuid;
  v_qty        integer;
  v_available  integer;
begin
  -- ── Auth guard ───────────────────────────────────────────────────────────────
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- ── Same-branch guard ────────────────────────────────────────────────────────
  if p_source_branch_id = p_dest_branch_id then
    raise exception 'source and destination must differ';
  end if;

  -- ── Resolve and validate both branches (same organisation) ───────────────────
  select organisation_id into v_org_id
    from public.branches
   where id = p_source_branch_id and deleted_at is null;
  if v_org_id is null then
    raise exception 'source branch not found';
  end if;

  select organisation_id into v_dest_org
    from public.branches
   where id = p_dest_branch_id and deleted_at is null;
  if v_dest_org is null then
    raise exception 'destination branch not found';
  end if;

  if v_org_id <> v_dest_org then
    raise exception 'cannot transfer between different organisations';
  end if;

  -- ── Authorisation — caller needs WRITE access to the SOURCE branch ───────────
  -- owner of the org, or inventory member of the source branch.
  if p_source_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to send stock from this branch';
  end if;

  -- ── Lines required ────────────────────────────────────────────────────────────
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a transfer must have at least one line';
  end if;

  -- ── Create transfer header ────────────────────────────────────────────────────
  insert into public.stock_transfers (
    organisation_id,
    source_branch_id,
    dest_branch_id,
    status,
    initiated_by,
    note
  ) values (
    v_org_id,
    p_source_branch_id,
    p_dest_branch_id,
    'in_transit',
    v_user_id,
    nullif(trim(p_note), '')
  )
  returning id into v_transfer_id;

  -- ── Process each line ─────────────────────────────────────────────────────────
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty        := (v_line->>'quantity')::integer;

    -- Validate inputs.
    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be greater than 0';
    end if;

    -- Product must belong to this organisation.
    if not exists (
      select 1 from public.products
       where id = v_product_id
         and organisation_id = v_org_id
         and deleted_at is null
    ) then
      raise exception 'product % not found in this organisation', v_product_id;
    end if;

    -- ── SOURCE STOCK GUARD ────────────────────────────────────────────────────
    -- FOR UPDATE locks the source product_stock row for the transaction.
    -- A concurrent initiation for the same product at the same source branch
    -- blocks here, then re-reads the decremented quantity — correctly failing
    -- the guard if stock ran out.
    -- coalesce(v_available, 0): if no product_stock row exists, stock = 0.
    select coalesce(quantity, 0) into v_available
      from public.product_stock
     where branch_id  = p_source_branch_id
       and product_id = v_product_id
     for update;

    if coalesce(v_available, 0) < v_qty then
      raise exception
        'insufficient stock for product % at source branch (on hand: %, sending: %)',
        v_product_id, coalesce(v_available, 0), v_qty;
    end if;

    -- ── Insert transfer line ──────────────────────────────────────────────────
    insert into public.stock_transfer_lines (transfer_id, product_id, quantity_sent)
    values (v_transfer_id, v_product_id, v_qty);

    -- ── Ledger: transfer_out at source ────────────────────────────────────────
    -- reason = 'transfer_out', holder_user_id = NULL (branch movement).
    -- 'transfer_out' is NOT in the holder_consistency constrained list →
    -- holder_user_id IS NULL is required and satisfied here.
    insert into public.stock_ledger (
      organisation_id,
      branch_id,
      product_id,
      quantity_delta,
      reason,
      reference_type,
      reference_id,
      created_by
    ) values (
      v_org_id,
      p_source_branch_id,
      v_product_id,
      -v_qty,            -- stock LEAVES source branch into transit
      'transfer_out',
      'stock_transfer',
      v_transfer_id,
      v_user_id
    );

    -- ── Decrement source product_stock ────────────────────────────────────────
    -- Stock guard above confirmed quantity >= v_qty.
    -- Stock is now "in transit" — not reflected in any branch's on-hand qty
    -- until receive_transfer credits the destination.
    update public.product_stock
       set quantity   = quantity - v_qty,
           updated_at = now()
     where branch_id  = p_source_branch_id
       and product_id = v_product_id;

  end loop;

  return v_transfer_id;
end;
$$;

revoke all    on function public.initiate_transfer(uuid, uuid, text, jsonb) from public;
grant execute on function public.initiate_transfer(uuid, uuid, text, jsonb) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 8. receive_transfer RPC
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Called by owner/inventory of the DESTINATION branch. For each line:
--   • Validates the line belongs to this transfer.
--   • quantity_received must be 0 ≤ x ≤ quantity_sent.
--   • Writes stock_ledger transfer_in (+qty_received, holder NULL) at dest.
--   • Upserts destination product_stock (dest may never have held this product).
--   • Lines with quantity_received = 0 are recorded but produce no ledger row
--     or product_stock change (shortfall of 100%).
--
-- Partial receipt: if quantity_received < quantity_sent for any line, the
-- difference is stock that physically left the source but was not received.
-- It is NOT credited to either branch and produces no additional ledger entry.
-- The discrepancy is visible by comparing the two quantity columns on the line.
--
-- The transfer status is set to 'received' regardless of whether receipt was
-- full or partial — once recorded, receipt is final.
-- An optional p_note appended to the transfer header (e.g. "2 units damaged").
--
-- Returns: 'received'

create or replace function public.receive_transfer(
  p_transfer_id uuid,
  p_lines       jsonb,   -- array of { line_id, quantity_received }
  p_note        text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id   uuid := auth.uid();
  v_transfer  public.stock_transfers%rowtype;
  v_line      jsonb;
  v_line_id   uuid;
  v_qty_recv  integer;
  v_xfer_line public.stock_transfer_lines%rowtype;
begin
  -- ── Auth guard ───────────────────────────────────────────────────────────────
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- ── Fetch and validate transfer ───────────────────────────────────────────────
  select * into v_transfer
    from public.stock_transfers
   where id = p_transfer_id;

  if v_transfer.id is null then
    raise exception 'transfer not found';
  end if;

  if v_transfer.status <> 'in_transit' then
    raise exception 'transfer is not in transit';
  end if;

  -- ── Authorisation — caller needs WRITE access to the DESTINATION branch ──────
  if v_transfer.dest_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to receive stock at the destination branch';
  end if;

  -- ── Lines required ────────────────────────────────────────────────────────────
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no received lines provided';
  end if;

  -- ── Process each line ─────────────────────────────────────────────────────────
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id  := (v_line->>'line_id')::uuid;
    v_qty_recv := (v_line->>'quantity_received')::integer;

    -- Verify the line belongs to this transfer (prevents cross-transfer injection).
    select * into v_xfer_line
      from public.stock_transfer_lines
     where id = v_line_id
       and transfer_id = p_transfer_id;

    if v_xfer_line.id is null then
      raise exception 'line % is not part of this transfer', v_line_id;
    end if;

    if v_qty_recv is null or v_qty_recv < 0 then
      raise exception 'received quantity must be >= 0 for line %', v_line_id;
    end if;

    if v_qty_recv > v_xfer_line.quantity_sent then
      raise exception
        'cannot receive more than sent for line % (sent: %, received: %)',
        v_line_id, v_xfer_line.quantity_sent, v_qty_recv;
    end if;

    -- Record actual quantity received on the line (even for 0 = total shortfall).
    update public.stock_transfer_lines
       set quantity_received = v_qty_recv
     where id = v_line_id;

    -- Nothing to credit if nothing was received for this line; skip stock writes.
    if v_qty_recv = 0 then
      continue;
    end if;

    -- ── Ledger: transfer_in at destination ────────────────────────────────────
    -- reason = 'transfer_in', holder_user_id = NULL (branch movement).
    -- 'transfer_in' is NOT in the holder_consistency constrained list →
    -- holder_user_id IS NULL is required and satisfied here.
    insert into public.stock_ledger (
      organisation_id,
      branch_id,
      product_id,
      quantity_delta,
      reason,
      reference_type,
      reference_id,
      created_by
    ) values (
      v_transfer.organisation_id,
      v_transfer.dest_branch_id,
      v_xfer_line.product_id,
      v_qty_recv,        -- stock ARRIVES at destination branch
      'transfer_in',
      'stock_transfer',
      p_transfer_id,
      v_user_id
    );

    -- ── Upsert destination product_stock ──────────────────────────────────────
    -- The destination branch may never have held this product before — upsert
    -- creates the row if it does not exist rather than failing the update.
    insert into public.product_stock (
      organisation_id,
      branch_id,
      product_id,
      quantity
    ) values (
      v_transfer.organisation_id,
      v_transfer.dest_branch_id,
      v_xfer_line.product_id,
      v_qty_recv
    )
    on conflict (branch_id, product_id)
    do update
      set quantity   = product_stock.quantity + excluded.quantity,
          updated_at = now();

  end loop;

  -- ── Close the transfer ────────────────────────────────────────────────────────
  -- p_note overwrites the header note if supplied; otherwise keeps the original.
  update public.stock_transfers
     set status      = 'received',
         received_by = v_user_id,
         received_at = now(),
         note        = coalesce(nullif(trim(p_note), ''), note)
   where id = p_transfer_id;

  return 'received';
end;
$$;

revoke all    on function public.receive_transfer(uuid, jsonb, text) from public;
grant execute on function public.receive_transfer(uuid, jsonb, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 9. cancel_transfer RPC
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Called by owner/inventory of the SOURCE branch (the sender recalls their
-- own shipment). The destination has not yet received anything, so the full
-- quantity_sent is credited back to source for every line.
--
-- Guards:
--   • transfer must be status = 'in_transit'  (cannot cancel a received or
--     already-cancelled transfer)
--   • caller must have WRITE access to the SOURCE branch
--
-- For each line:
--   • Writes a 'transfer_in' ledger row at SOURCE (+quantity_sent, holder NULL).
--     transfer_in is already in the reason CHECK and is holder-NULL-allowed —
--     no constraint change needed. The reference_id points to the transfer so
--     it is fully traceable as a cancellation credit in the stock history.
--   • Upserts source product_stock (+quantity_sent), same pattern as
--     receive_transfer does for the destination.
--
-- Sets status = 'cancelled', cancelled_at = now(), cancelled_by = caller.
-- Optional p_note appended to the header note.
--
-- Returns: 'cancelled'

create or replace function public.cancel_transfer(
  p_transfer_id uuid,
  p_note        text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_transfer public.stock_transfers%rowtype;
  v_line     public.stock_transfer_lines%rowtype;
begin
  -- ── Auth guard ───────────────────────────────────────────────────────────────
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- ── Fetch and validate transfer ───────────────────────────────────────────────
  select * into v_transfer
    from public.stock_transfers
   where id = p_transfer_id;

  if v_transfer.id is null then
    raise exception 'transfer not found';
  end if;

  if v_transfer.status <> 'in_transit' then
    raise exception 'only in-transit transfers can be cancelled';
  end if;

  -- ── Authorisation — caller needs WRITE access to the SOURCE branch ───────────
  -- The sender recalls their own shipment. The destination has no say — they
  -- have not received the stock and have no claim on it yet.
  if v_transfer.source_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to cancel this transfer';
  end if;

  -- ── Credit every line's quantity_sent back to source ─────────────────────────
  for v_line in
    select * from public.stock_transfer_lines
     where transfer_id = p_transfer_id
  loop
    -- Ledger: transfer_in at SOURCE (cancellation credit).
    -- +quantity_sent: the full sent quantity returns to source because the
    -- destination never received anything.
    -- reason = 'transfer_in', holder_user_id = NULL (branch movement).
    insert into public.stock_ledger (
      organisation_id,
      branch_id,
      product_id,
      quantity_delta,
      reason,
      reference_type,
      reference_id,
      created_by
    ) values (
      v_transfer.organisation_id,
      v_transfer.source_branch_id,   -- ← SOURCE, not dest
      v_line.product_id,
      v_line.quantity_sent,           -- ← full sent qty returns
      'transfer_in',
      'stock_transfer',
      p_transfer_id,
      v_user_id
    );

    -- Re-increment source product_stock.
    -- Upsert: if the row was somehow removed, recreate it rather than silently
    -- failing the update.
    insert into public.product_stock (
      organisation_id,
      branch_id,
      product_id,
      quantity
    ) values (
      v_transfer.organisation_id,
      v_transfer.source_branch_id,
      v_line.product_id,
      v_line.quantity_sent
    )
    on conflict (branch_id, product_id)
    do update
      set quantity   = product_stock.quantity + excluded.quantity,
          updated_at = now();

  end loop;

  -- ── Close the transfer ────────────────────────────────────────────────────────
  update public.stock_transfers
     set status       = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_user_id,
         note         = coalesce(nullif(trim(p_note), ''), note)
   where id = p_transfer_id;

  return 'cancelled';
end;
$$;

revoke all    on function public.cancel_transfer(uuid, text) from public;
grant execute on function public.cancel_transfer(uuid, text) to authenticated;
