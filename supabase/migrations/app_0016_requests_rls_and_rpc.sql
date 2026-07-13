-- ─────────────────────────────────────────────────────────────────────────────
-- app_0016_requests_rls_and_rpc.sql
-- RLS on stock_requests + stock_request_lines, and the review_stock_request
-- security-definer RPC.
--
-- Access model:
--   stock_requests
--     SELECT  — any branch member (read-branch helper covers direct members + org owners)
--     INSERT  — any branch member (requesting stock is not a privileged act)
--     UPDATE  — requesters may ONLY cancel their own pending request via direct
--               UPDATE; ALL other status transitions (approve/reject) go through
--               the review_stock_request RPC. This ensures self-approval is
--               impossible via direct table write.
--
--   stock_request_lines
--     SELECT  — via user_readable_request_ids() (avoids RLS-on-RLS cascade)
--     INSERT  — via user_pending_request_ids()  (own pending requests only)
--     UPDATE  — NONE. The RPC (security definer) writes quantity_approved.
--               Absence of a write policy = denied at the DB layer.
--     DELETE  — NONE. Cascade from stock_requests soft-delete handles cleanup.
--
-- Reused helpers (defined in app_0009_vendors_rls.sql):
--   user_vendor_read_branch_ids()  — branches the user may read
--   user_vendor_write_branch_ids() — branches the user may write (owner + inventory)
--
-- New helpers defined here:
--   user_readable_request_ids()   — for stock_request_lines SELECT
--   user_pending_request_ids()    — for stock_request_lines INSERT
--     Using the security-definer helper pattern (same as user_readable_invoice_ids)
--     avoids querying an RLS-protected table inside a policy, which would cause
--     an RLS-on-RLS cascade. This means no separate creation RPC is needed: the
--     app creates request headers and lines with ordinary INSERTs, guarded by
--     these helpers, while the security-definer RPC handles the privileged
--     review path (stock movement + status update) exclusively.
--
-- Depends on: app_0009_vendors_rls (helpers reused above)
--             app_0010_stock (product_stock, stock_ledger)
--             app_0015_requests (tables being secured)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Security-definer helpers ──────────────────────────────────────────────────

-- Returns the IDs of stock_requests whose branch the current user may read.
-- Mirrors user_readable_invoice_ids() from app_0011_stock_rls.sql.
-- Used by the stock_request_lines SELECT policy to avoid querying an
-- RLS-protected table (stock_requests) from inside another table's policy.
create or replace function public.user_readable_request_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
  from public.stock_requests
  where deleted_at is null
    and branch_id in (select public.user_vendor_read_branch_ids());
$$;

revoke all  on function public.user_readable_request_ids from public;
grant execute on function public.user_readable_request_ids to authenticated;

-- Returns IDs of pending stock_requests created by the current user.
-- Used by the stock_request_lines INSERT policy: a user may add lines only
-- to their own pending (not yet reviewed) requests.
create or replace function public.user_pending_request_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
  from public.stock_requests
  where deleted_at is null
    and status    = 'pending'
    and requested_by = auth.uid();
$$;

revoke all  on function public.user_pending_request_ids from public;
grant execute on function public.user_pending_request_ids to authenticated;

-- ── Enable RLS ────────────────────────────────────────────────────────────────

alter table public.stock_requests      enable row level security;
alter table public.stock_request_lines enable row level security;

-- ── stock_requests policies ───────────────────────────────────────────────────

-- Any branch member (or org owner) may read requests in their branch.
-- This lets Inventory/Owner see the queue AND lets requesters see their own history.
create policy "read stock_requests in own branch"
  on public.stock_requests
  for select
  using (
    branch_id in (select public.user_vendor_read_branch_ids())
  );

-- Any branch member may raise a request. The requester must be the calling user —
-- no requesting on behalf of others.
create policy "insert stock_requests as branch member"
  on public.stock_requests
  for insert
  with check (
    branch_id    in (select public.user_vendor_read_branch_ids())
    and requested_by = auth.uid()
  );

-- Requesters may cancel their own PENDING request via direct UPDATE.
-- No other status transitions are permitted here:
--   USING ensures the row being updated is currently pending and owned by the caller.
--   WITH CHECK ensures the resulting row sets status = 'cancelled' (and nothing else).
-- This means a user cannot self-approve, self-reject, or escalate status through the
-- table; ALL other transitions happen exclusively via the review_stock_request RPC.
create policy "requester can cancel own pending request"
  on public.stock_requests
  for update
  using  (requested_by = auth.uid() and status = 'pending')
  with check (requested_by = auth.uid() and status = 'cancelled');

-- ── stock_request_lines policies ──────────────────────────────────────────────

-- SELECT gated through user_readable_request_ids() to avoid RLS-on-RLS cascades.
create policy "read stock_request_lines via parent request"
  on public.stock_request_lines
  for select
  using (
    request_id in (select public.user_readable_request_ids())
  );

-- INSERT allowed if the parent request is the caller's own pending request.
-- user_pending_request_ids() returns only (status='pending' AND requested_by=auth.uid()),
-- so a user cannot add lines to someone else's request or to a reviewed request.
create policy "insert stock_request_lines on own pending request"
  on public.stock_request_lines
  for insert
  with check (
    request_id in (select public.user_pending_request_ids())
  );

-- No UPDATE or DELETE policy on stock_request_lines.
-- UPDATE of quantity_approved is written exclusively by the review_stock_request RPC
-- (which runs as security definer and bypasses RLS). Absence of a user UPDATE policy
-- means direct updates are denied at the database layer. DELETE is handled by the
-- ON DELETE CASCADE from stock_requests.

-- ── review_stock_request RPC ──────────────────────────────────────────────────
--
-- Called by an authenticated owner or inventory member to approve or reject a
-- pending stock request. Runs as security definer to:
--   1. Read the request + lines without RLS interference.
--   2. Write to stock_ledger and product_stock (no user write policies exist).
--   3. Update quantity_approved on lines and status on the request header.
--
-- Decisions:
--   'reject' — marks all lines quantity_approved=0, sets status='rejected'.
--              No stock movement occurs.
--   'approve' — processes p_lines (array of {line_id, quantity_approved}).
--               For each line with quantity_approved > 0:
--                 • Guards against negative stock (raises if insufficient).
--                 • Appends a negative-delta row to stock_ledger (reason='request_fulfilment').
--                 • Decrements product_stock.quantity.
--               Final status:
--                 all lines qty=0         → 'rejected'
--                 any qty < requested     → 'partially_approved'
--                 all qty = requested     → 'approved'
--
-- Returns: the resulting request status string.

create or replace function public.review_stock_request(
  p_request_id  uuid,
  p_decision    text,    -- 'approve' or 'reject'
  p_lines       jsonb,   -- for approve: array of { line_id, quantity_approved }
  p_review_note text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id       uuid    := auth.uid();
  v_req           stock_requests%rowtype;
  v_line          jsonb;
  v_line_id       uuid;
  v_qty_approved  integer;
  v_req_line      stock_request_lines%rowtype;
  v_available     integer;
  v_any_approved  boolean := false;
  v_any_reduced   boolean := false;
  v_final_status  text;
begin
  -- ── 1. Auth guard ─────────────────────────────────────────────────────────
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- ── 2. Fetch the request (security definer bypasses RLS) ──────────────────
  select * into v_req
    from public.stock_requests
   where id = p_request_id
     and deleted_at is null;

  if v_req.id is null then
    raise exception 'request not found';
  end if;

  -- ── 3. Status guard — only pending requests may be reviewed ───────────────
  if v_req.status <> 'pending' then
    raise exception 'request already reviewed';
  end if;

  -- ── 4. Authorisation — caller must have WRITE access to the branch ─────────
  -- write branch = owner of the org, or inventory member of the branch.
  -- This is the same check used by record_vendor_invoice.
  if v_req.branch_id not in (select public.user_vendor_write_branch_ids()) then
    raise exception 'not authorised to review requests in this branch';
  end if;

  -- ── 5. Rejection path ─────────────────────────────────────────────────────
  -- Mark all lines as quantity_approved=0 and close the request.
  -- No stock movement occurs on a full rejection.
  if p_decision = 'reject' then
    update public.stock_request_lines
       set quantity_approved = 0
     where request_id = p_request_id;

    update public.stock_requests
       set status      = 'rejected',
           reviewed_by = v_user_id,
           reviewed_at = now(),
           review_note = nullif(p_review_note, '')
     where id = p_request_id;

    return 'rejected';
  end if;

  -- ── 6. Validate decision value ─────────────────────────────────────────────
  if p_decision <> 'approve' then
    raise exception 'invalid decision: must be ''approve'' or ''reject''';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no lines provided for approval';
  end if;

  -- ── 7. Approval path — process each line ──────────────────────────────────
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id      := (v_line->>'line_id')::uuid;
    v_qty_approved := (v_line->>'quantity_approved')::integer;

    -- Verify the line belongs to this request (prevents cross-request injection).
    select * into v_req_line
      from public.stock_request_lines
     where id = v_line_id
       and request_id = p_request_id;

    if v_req_line.id is null then
      raise exception 'line % is not part of this request', v_line_id;
    end if;

    -- quantity_approved must be a non-negative integer.
    if v_qty_approved is null or v_qty_approved < 0 then
      raise exception 'approved quantity for line % must be >= 0', v_line_id;
    end if;

    -- Cannot approve more than the requester asked for (DB constraint also enforces this).
    if v_qty_approved > v_req_line.quantity_requested then
      raise exception 'cannot approve more than requested for line % (requested %, got %)',
        v_line_id, v_req_line.quantity_requested, v_qty_approved;
    end if;

    -- Record the approved quantity on the line (even for 0 = rejected line).
    update public.stock_request_lines
       set quantity_approved = v_qty_approved
     where id = v_line_id;

    -- Track whether any line is reduced (for partial status) or zero (for rejected).
    if v_qty_approved < v_req_line.quantity_requested then
      v_any_reduced := true;
    end if;

    -- Nothing to move for this line if approved quantity is zero; skip stock writes.
    if v_qty_approved = 0 then
      continue;
    end if;

    v_any_approved := true;

    -- ── STOCK GUARD: prevent negative stock ───────────────────────────────────
    -- Reads product_stock directly (security definer bypasses RLS).
    -- If no row exists, coalesce returns 0 (product was never stocked in this branch).
    select coalesce(quantity, 0) into v_available
      from public.product_stock
     where branch_id  = v_req.branch_id
       and product_id = v_req_line.product_id;

    if coalesce(v_available, 0) < v_qty_approved then
      raise exception
        'insufficient stock for product % in branch % (on hand: %, requested: %)',
        v_req_line.product_id, v_req.branch_id,
        coalesce(v_available, 0), v_qty_approved;
    end if;

    -- ── Ledger: append a negative-delta stock movement ────────────────────────
    -- Ledger + product_stock update happen together in the same transaction
    -- (same loop iteration), so they cannot drift.
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
      v_req.organisation_id,
      v_req.branch_id,
      v_req_line.product_id,
      -v_qty_approved,            -- stock LEAVES the branch
      'request_fulfilment',
      'stock_request',
      p_request_id,
      v_user_id
    );

    -- ── Decrement product_stock ───────────────────────────────────────────────
    -- The stock guard above has already confirmed quantity >= v_qty_approved,
    -- so this update cannot push quantity below zero.
    update public.product_stock
       set quantity   = quantity - v_qty_approved,
           updated_at = now()
     where branch_id  = v_req.branch_id
       and product_id = v_req_line.product_id;

  end loop;

  -- ── 8. Determine final status ─────────────────────────────────────────────
  --
  --   v_any_approved = false  →  every line was approved at qty=0  →  'rejected'
  --   v_any_approved = true,
  --     v_any_reduced = false →  every approved line is at full qty  →  'approved'
  --   v_any_approved = true,
  --     v_any_reduced = true  →  at least one line short or zeroed   →  'partially_approved'
  --
  if not v_any_approved then
    v_final_status := 'rejected';
  elsif v_any_reduced then
    v_final_status := 'partially_approved';
  else
    v_final_status := 'approved';
  end if;

  update public.stock_requests
     set status      = v_final_status,
         reviewed_by = v_user_id,
         reviewed_at = now(),
         review_note = nullif(p_review_note, '')
   where id = p_request_id;

  return v_final_status;
end;
$$;

revoke all  on function public.review_stock_request(uuid, text, jsonb, text) from public;
grant execute on function public.review_stock_request(uuid, text, jsonb, text) to authenticated;
