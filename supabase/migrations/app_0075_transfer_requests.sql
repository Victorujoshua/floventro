-- ─────────────────────────────────────────────────────────────────────────────
-- app_0075_transfer_requests.sql
--
-- Branch-to-branch stock requests, approved by the sending branch before any
-- stock moves.
--
-- Flow:
--   1. create_transfer_request   — owner/admin/inventory of the DESTINATION
--      branch asks a specific SOURCE branch for stock. Nothing moves.
--   2. approve_transfer_request  — owner/admin/inventory of the SOURCE branch
--      approves per line (quantity_approved, 0 = line refused). The approved
--      quantities are sent through the same transfer logic as a direct send,
--      creating an in_transit stock_transfers row; its id is stored on the
--      request (transfer_id). Receiving is the existing receive_transfer.
--      All lines approved at 0 → request is 'rejected', no transfer.
--   3. reject_transfer_request   — SOURCE branch refuses the whole request.
--   4. cancel_transfer_request   — the requester withdraws it while pending.
--
-- stock_transfers is unchanged: every row there is still stock that moved.
-- Costing, ledger and reports are untouched.
--
-- Direct send (initiate_transfer) is now owner/admin only — inventory must
-- request. The send logic itself moves, unchanged, into the internal
-- transfer_stock_internal(); initiate_transfer and approve_transfer_request
-- are thin wrappers with their own permission checks. The shared
-- user_vendor_write_branch_ids() helper is NOT changed — it also governs
-- invoices, receipts and adjustments.
--
-- receive_transfer and cancel_transfer are not modified, so transfers already
-- in transit behave exactly as before.
--
-- Depends on: app_0028 (stock_transfers), app_0038 (initiate_transfer body,
--             drain_fifo_layers), app_0046 (admin role, user_admin_branch_ids),
--             app_0009 (user_vendor_read/write_branch_ids), app_0001 (set_updated_at)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. Tables
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.transfer_requests (
  id                    uuid        primary key default gen_random_uuid(),
  organisation_id       uuid        not null references public.organisations(id) on delete restrict,
  -- Branch asked to send the stock (reviews the request)
  source_branch_id      uuid        not null references public.branches(id)      on delete restrict,
  -- Branch asking for the stock (raised the request)
  destination_branch_id uuid        not null references public.branches(id)      on delete restrict,
  requested_by          uuid        not null references auth.users(id),
  note                  text,
  status                text        not null default 'pending'
                                    check (status in (
                                      'pending',
                                      'approved',
                                      'partially_approved',
                                      'rejected',
                                      'cancelled'
                                    )),
  reviewed_by           uuid                 references auth.users(id),
  reviewed_at           timestamptz,
  review_note           text,
  -- Set on approval: the in_transit transfer that carries the approved stock
  transfer_id           uuid                 references public.stock_transfers(id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint transfer_requests_diff_branches check (source_branch_id <> destination_branch_id)
);

create trigger transfer_requests_updated_at
  before update on public.transfer_requests
  for each row execute function public.set_updated_at();

-- Review queue at the source; "my requests" at the destination
create index transfer_requests_source_status_idx on public.transfer_requests (source_branch_id, status);
create index transfer_requests_dest_status_idx   on public.transfer_requests (destination_branch_id, status);
create index transfer_requests_org_idx           on public.transfer_requests (organisation_id);

create table public.transfer_request_lines (
  id                  uuid    primary key default gen_random_uuid(),
  transfer_request_id uuid    not null references public.transfer_requests(id) on delete cascade,
  product_id          uuid    not null references public.products(id)          on delete restrict,
  quantity_requested  integer not null check (quantity_requested > 0),
  -- NULL until reviewed; 0 = line refused. Same rules as stock_request_lines.
  quantity_approved   integer,
  check (quantity_approved is null or quantity_approved >= 0),
  check (quantity_approved is null or quantity_approved <= quantity_requested),
  unique (transfer_request_id, product_id)
);

create index transfer_request_lines_request_idx on public.transfer_request_lines (transfer_request_id);


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. Read access — members of either branch (same rule as stock_transfers)
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.user_readable_transfer_request_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
    from public.transfer_requests
   where source_branch_id      in (select public.user_vendor_read_branch_ids())
      or destination_branch_id in (select public.user_vendor_read_branch_ids());
$$;

revoke all    on function public.user_readable_transfer_request_ids() from public, anon;
grant execute on function public.user_readable_transfer_request_ids() to authenticated;

alter table public.transfer_requests      enable row level security;
alter table public.transfer_requests      force row level security;
alter table public.transfer_request_lines enable row level security;
alter table public.transfer_request_lines force row level security;

create policy "transfer_requests: read if member of either branch"
  on public.transfer_requests
  for select
  using (
    source_branch_id      in (select public.user_vendor_read_branch_ids())
    or destination_branch_id in (select public.user_vendor_read_branch_ids())
  );

-- Lines via the helper, avoiding RLS-on-RLS recursion (same as stock_transfer_lines)
create policy "transfer_request_lines: visible with parent request"
  on public.transfer_request_lines
  for select
  using (transfer_request_id in (select public.user_readable_transfer_request_ids()));

-- No INSERT / UPDATE / DELETE policies — writes only through the RPCs below.
revoke all on table public.transfer_requests      from public, anon;
revoke all on table public.transfer_request_lines from public, anon;
revoke insert, update, delete, truncate on table public.transfer_requests      from authenticated;
revoke insert, update, delete, truncate on table public.transfer_request_lines from authenticated;
grant select on table public.transfer_requests      to authenticated;
grant select on table public.transfer_request_lines to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 3. transfer_stock_internal — the send logic, moved out of initiate_transfer
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Body copied verbatim from app_0038's initiate_transfer, minus its
-- "not authorised to send stock from this branch" check. Callers do their own
-- permission check first. NOT callable by users: execute is revoked from
-- public, anon and authenticated (Supabase grants new functions to anon and
-- authenticated by default, so "from public" alone would not be enough).

create or replace function public.transfer_stock_internal(
  p_source_branch_id uuid,
  p_dest_branch_id   uuid,
  p_note             text,
  p_lines            jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_org_id       uuid;
  v_dest_org     uuid;
  v_transfer_id  uuid;
  v_line         jsonb;
  v_product_id   uuid;
  v_qty          integer;
  v_available    integer;
  -- ── weighted cost-state accumulators + per-line id for precise stamp ──────
  v_xfer_line_id uuid;
  v_pool_qty     integer;
  v_pool_avg     bigint;
  v_pool_total   bigint;
  v_new_qty      integer;
  v_new_total    bigint;
  v_new_avg      bigint;
  -- ── NEW (FIFO) ────────────────────────────────────────────────────────────
  v_fifo_row     public.fifo_drain_row;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_source_branch_id = p_dest_branch_id then
    raise exception 'source and destination must differ';
  end if;

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

  -- (permission check removed — callers check before calling)

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a transfer must have at least one line';
  end if;

  insert into public.stock_transfers (
    organisation_id, source_branch_id, dest_branch_id, status, initiated_by, note
  ) values (
    v_org_id, p_source_branch_id, p_dest_branch_id, 'in_transit',
    v_user_id, nullif(trim(p_note), '')
  )
  returning id into v_transfer_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty        := (v_line->>'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be greater than 0';
    end if;

    if not exists (
      select 1 from public.products
       where id = v_product_id and organisation_id = v_org_id and deleted_at is null
    ) then
      raise exception 'product % not found in this organisation', v_product_id;
    end if;

    -- FOR UPDATE on product_stock — cost-state lock follows below.
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

    insert into public.stock_transfer_lines (transfer_id, product_id, quantity_sent)
    values (v_transfer_id, v_product_id, v_qty)
    returning id into v_xfer_line_id;

    insert into public.stock_ledger (
      organisation_id, branch_id, product_id, quantity_delta,
      reason, reference_type, reference_id, created_by
    ) values (
      v_org_id, p_source_branch_id, v_product_id, -v_qty,
      'transfer_out', 'stock_transfer', v_transfer_id, v_user_id
    );

    update public.product_stock
       set quantity   = quantity - v_qty,
           updated_at = now()
     where branch_id  = p_source_branch_id
       and product_id = v_product_id;

    -- ── weighted: stamp cost at send + decrement source pool ──────────────────
    select quantity, avg_cost_cents, total_cost_cents
      into v_pool_qty, v_pool_avg, v_pool_total
      from public.product_cost_state
     where branch_id      = p_source_branch_id
       and product_id     = v_product_id
       and holder_user_id is null
     for update;

    -- Stamp only the line just inserted (by id, not product_id) so a transfer
    -- with the same product on two rows doesn't cross-contaminate the second
    -- row's stamp with the post-first-decrement state.
    update public.stock_transfer_lines
       set cost_at_send_cents = v_pool_avg        -- NULL if source cost unknown
     where id = v_xfer_line_id;

    -- Decrement source pool. Removing units at avg does not change avg.
    -- If qty hits 0: avg→NULL, total→0.
    v_pool_qty  := coalesce(v_pool_qty, 0);
    v_new_qty   := greatest(v_pool_qty - v_qty, 0);
    v_new_total := case
                     when v_new_qty = 0      then 0
                     when v_pool_avg is null  then null
                     else coalesce(v_pool_total, 0) - (v_qty * v_pool_avg)
                   end;
    v_new_avg   := case when v_new_qty = 0 then null else v_pool_avg end;

    insert into public.product_cost_state (
      organisation_id, branch_id, holder_user_id, product_id,
      quantity, avg_cost_cents, total_cost_cents
    ) values (
      v_org_id, p_source_branch_id, null, v_product_id,
      v_new_qty, v_new_avg, v_new_total
    )
    on conflict (branch_id, product_id) where holder_user_id is null
    do update set
      quantity         = excluded.quantity,
      avg_cost_cents   = excluded.avg_cost_cents,
      total_cost_cents = excluded.total_cost_cents,
      updated_at       = now();
    -- ── END weighted ──────────────────────────────────────────────────────────

    -- ── NEW (FIFO): drain source lots, snapshot into transfer_cost_layers ─────
    -- drain_fifo_layers() locks and decrements source pool lots oldest-first.
    -- INSERT...SELECT directly snapshots each drained lot into transfer_cost_layers;
    -- original_seq is carried unchanged so the destination can honour global FIFO.
    -- unit_cost_cents NULL (unknown-cost lot) propagates through transit as NULL.
    --
    -- v_xfer_line_id identifies exactly this line (set above via RETURNING) so
    -- that when the same product appears twice in one transfer, each line's lot
    -- snapshot is kept separate.
    for v_fifo_row in
      select * from public.drain_fifo_layers(
        v_org_id,
        p_source_branch_id,
        null,                      -- drain from source pool bucket
        v_product_id,
        v_qty
      )
    loop
      insert into public.transfer_cost_layers (
        organisation_id, transfer_line_id, original_seq, quantity, unit_cost_cents
      ) values (
        v_org_id,
        v_xfer_line_id,
        v_fifo_row.original_seq,
        v_fifo_row.qty_consumed,
        v_fifo_row.unit_cost_cents  -- NULL propagates (unknown lot stays unknown in transit)
      );
    end loop;
    -- ── END NEW (FIFO) ────────────────────────────────────────────────────────

  end loop;

  return v_transfer_id;
end;
$$;

revoke all on function public.transfer_stock_internal(uuid, uuid, text, jsonb) from public, anon, authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 4. initiate_transfer — direct send, now owner/admin only
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- Signature unchanged (existing grant kept). Inventory must use
-- create_transfer_request instead.

create or replace function public.initiate_transfer(
  p_source_branch_id uuid,
  p_dest_branch_id   uuid,
  p_note             text,
  p_lines            jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id  uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select organisation_id into v_org_id
    from public.branches
   where id = p_source_branch_id and deleted_at is null;
  if v_org_id is null then
    raise exception 'source branch not found';
  end if;

  -- Owner of the organisation, or admin of the source branch.
  if not (
    exists (
      select 1 from public.memberships
       where user_id = v_user_id
         and organisation_id = v_org_id
         and role = 'owner'
         and deleted_at is null
    )
    or p_source_branch_id in (select public.user_admin_branch_ids())
  ) then
    raise exception 'not authorised to send stock from this branch — request a transfer instead';
  end if;

  return public.transfer_stock_internal(p_source_branch_id, p_dest_branch_id, p_note, p_lines);
end;
$$;

revoke all    on function public.initiate_transfer(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.initiate_transfer(uuid, uuid, text, jsonb) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 5. get_branch_available_stock — another branch's quantities, nothing else
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- product_stock is only readable for one's own branches. The request form needs
-- "Main has 340" for the branch being asked, so this returns just
-- (product_id, quantity) for one branch of the caller's organisation.
-- Callers: owner/admin/inventory of any branch in the same organisation.

create or replace function public.get_branch_available_stock(p_branch_id uuid)
returns table (product_id uuid, quantity integer)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select organisation_id into v_org_id
    from public.branches
   where id = p_branch_id and deleted_at is null;
  if v_org_id is null then
    raise exception 'branch not found';
  end if;

  if not exists (
    select 1 from public.branches b
     where b.organisation_id = v_org_id
       and b.id in (select public.user_vendor_write_branch_ids())
  ) then
    raise exception 'not authorised to view stock for this branch';
  end if;

  return query
    select ps.product_id, ps.quantity
      from public.product_stock ps
     where ps.branch_id = p_branch_id
       and ps.quantity > 0;
end;
$$;

revoke all    on function public.get_branch_available_stock(uuid) from public, anon;
grant execute on function public.get_branch_available_stock(uuid) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 6. create_transfer_request — destination branch asks the source branch
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- p_lines: [{ product_id, quantity }]. Each product at most once.

create or replace function public.create_transfer_request(
  p_source_branch_id uuid,
  p_dest_branch_id   uuid,
  p_note             text,
  p_lines            jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_org_id     uuid;
  v_dest_org   uuid;
  v_request_id uuid;
  v_line       jsonb;
  v_product_id uuid;
  v_qty        integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_source_branch_id = p_dest_branch_id then
    raise exception 'source and destination must differ';
  end if;

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

  if p_dest_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to request stock for this branch';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'a request must have at least one line';
  end if;

  insert into public.transfer_requests (
    organisation_id, source_branch_id, destination_branch_id, requested_by, note
  ) values (
    v_org_id, p_source_branch_id, p_dest_branch_id, v_user_id, nullif(trim(p_note), '')
  )
  returning id into v_request_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty        := (v_line->>'quantity')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be greater than 0';
    end if;

    if not exists (
      select 1 from public.products
       where id = v_product_id and organisation_id = v_org_id and deleted_at is null
    ) then
      raise exception 'product % not found in this organisation', v_product_id;
    end if;

    if exists (
      select 1 from public.transfer_request_lines
       where transfer_request_id = v_request_id and product_id = v_product_id
    ) then
      raise exception 'product % is listed more than once', v_product_id;
    end if;

    insert into public.transfer_request_lines (transfer_request_id, product_id, quantity_requested)
    values (v_request_id, v_product_id, v_qty);
  end loop;

  return v_request_id;
end;
$$;

revoke all    on function public.create_transfer_request(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.create_transfer_request(uuid, uuid, text, jsonb) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 7. approve_transfer_request — source branch approves, stock is sent
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- p_lines: [{ line_id, quantity_approved }]. Lines left out are approved at 0.
-- Status rules match review_stock_request: nothing approved → 'rejected';
-- anything reduced → 'partially_approved'; else 'approved'.
-- Stock checks happen in transfer_stock_internal; any failure (e.g. not enough
-- stock) rolls back the whole approval.

create or replace function public.approve_transfer_request(
  p_request_id  uuid,
  p_lines       jsonb,
  p_review_note text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_req          public.transfer_requests%rowtype;
  v_req_line     public.transfer_request_lines%rowtype;
  v_line         jsonb;
  v_line_id      uuid;
  v_qty_approved integer;
  v_send_lines   jsonb := '[]'::jsonb;
  v_any_reduced  boolean := false;
  v_transfer_id  uuid;
  v_final_status text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_req
    from public.transfer_requests
   where id = p_request_id
   for update;

  if v_req.id is null then
    raise exception 'request not found';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'request already reviewed';
  end if;

  if v_req.source_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to review requests for this branch';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no lines provided for approval';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id      := (v_line->>'line_id')::uuid;
    v_qty_approved := (v_line->>'quantity_approved')::integer;

    select * into v_req_line
      from public.transfer_request_lines
     where id = v_line_id
       and transfer_request_id = p_request_id;

    if v_req_line.id is null then
      raise exception 'line % is not part of this request', v_line_id;
    end if;

    if v_qty_approved is null or v_qty_approved < 0 then
      raise exception 'approved quantity for line % must be >= 0', v_line_id;
    end if;

    if v_qty_approved > v_req_line.quantity_requested then
      raise exception 'cannot approve more than requested for line % (requested %, got %)',
        v_line_id, v_req_line.quantity_requested, v_qty_approved;
    end if;

    update public.transfer_request_lines
       set quantity_approved = v_qty_approved
     where id = v_line_id;
  end loop;

  -- Lines not listed are refused.
  update public.transfer_request_lines
     set quantity_approved = 0
   where transfer_request_id = p_request_id
     and quantity_approved is null;

  select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity_approved)), '[]'::jsonb),
         coalesce(bool_or(quantity_approved < quantity_requested), false)
    into v_send_lines, v_any_reduced
    from public.transfer_request_lines
   where transfer_request_id = p_request_id
     and quantity_approved > 0;

  -- bool_or above only saw approved lines; a refused line is also a reduction.
  if exists (
    select 1 from public.transfer_request_lines
     where transfer_request_id = p_request_id and quantity_approved = 0
  ) then
    v_any_reduced := true;
  end if;

  if jsonb_array_length(v_send_lines) = 0 then
    v_final_status := 'rejected';
  else
    v_transfer_id := public.transfer_stock_internal(
      v_req.source_branch_id,
      v_req.destination_branch_id,
      coalesce(v_req.note, 'Requested transfer'),
      v_send_lines
    );
    v_final_status := case when v_any_reduced then 'partially_approved' else 'approved' end;
  end if;

  update public.transfer_requests
     set status      = v_final_status,
         reviewed_by = v_user_id,
         reviewed_at = now(),
         review_note = nullif(trim(p_review_note), ''),
         transfer_id = v_transfer_id
   where id = p_request_id;

  return v_final_status;
end;
$$;

revoke all    on function public.approve_transfer_request(uuid, jsonb, text) from public, anon;
grant execute on function public.approve_transfer_request(uuid, jsonb, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 8. reject_transfer_request — source branch refuses the whole request
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.reject_transfer_request(
  p_request_id  uuid,
  p_review_note text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_req     public.transfer_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_req
    from public.transfer_requests
   where id = p_request_id
   for update;

  if v_req.id is null then
    raise exception 'request not found';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'request already reviewed';
  end if;

  if v_req.source_branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to review requests for this branch';
  end if;

  update public.transfer_request_lines
     set quantity_approved = 0
   where transfer_request_id = p_request_id;

  update public.transfer_requests
     set status      = 'rejected',
         reviewed_by = v_user_id,
         reviewed_at = now(),
         review_note = nullif(trim(p_review_note), '')
   where id = p_request_id;

  return 'rejected';
end;
$$;

revoke all    on function public.reject_transfer_request(uuid, text) from public, anon;
grant execute on function public.reject_transfer_request(uuid, text) to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 9. cancel_transfer_request — requester withdraws while pending
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.cancel_transfer_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_req     public.transfer_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_req
    from public.transfer_requests
   where id = p_request_id
   for update;

  if v_req.id is null then
    raise exception 'request not found';
  end if;

  if v_req.requested_by <> v_user_id then
    raise exception 'only the requester can cancel this request';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'only pending requests can be cancelled';
  end if;

  update public.transfer_requests
     set status = 'cancelled'
   where id = p_request_id;

  return 'cancelled';
end;
$$;

revoke all    on function public.cancel_transfer_request(uuid) from public, anon;
grant execute on function public.cancel_transfer_request(uuid) to authenticated;

notify pgrst, 'reload schema';
