-- ─────────────────────────────────────────────────────────────────────────────
-- app_0017_fix_request_stock_race.sql
--
-- Supersedes the review_stock_request function defined in app_0016.
--
-- Bug fixed: the stock guard in app_0016 used a plain SELECT to read
-- product_stock.quantity, then later issued a separate UPDATE to decrement it.
-- Two concurrent approval calls for the same product could both pass the guard
-- (both reading the pre-decrement quantity) and both write their decrements,
-- producing a negative stock balance.
--
-- Fix: the stock guard SELECT now uses FOR UPDATE, which acquires a row-level
-- lock on the product_stock row for the duration of the transaction. A second
-- concurrent transaction attempting the same SELECT FOR UPDATE on the same row
-- BLOCKS until the first transaction commits. It then reads the already-
-- decremented quantity and correctly fails the guard if stock is now
-- insufficient. This serialises the check-and-decrement for each product row.
--
-- All other logic is byte-identical to app_0016.
-- ─────────────────────────────────────────────────────────────────────────────

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
    -- FOR UPDATE locks the product_stock row for the remainder of this transaction.
    -- A concurrent approval on the same product blocks here until we commit, then
    -- re-reads the decremented quantity — correctly failing the guard if stock ran out.
    -- If no row exists, coalesce returns 0 (product was never stocked in this branch).
    select coalesce(quantity, 0) into v_available
      from public.product_stock
     where branch_id  = v_req.branch_id
       and product_id = v_req_line.product_id
     for update;                                    -- ← THE FIX

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
