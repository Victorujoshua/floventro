-- ─────────────────────────────────────────────────────────────────────────────
-- app_0023_extend_review_request.sql
--
-- Extends review_stock_request to write the holding leg after every branch
-- stock decrement. This supersedes the function defined in app_0017.
--
-- ONLY CHANGE vs app_0017: two blocks are added inside the per-line loop,
-- immediately after the existing product_stock decrement UPDATE. Every other
-- line — guards, rejection path, status logic, FOR UPDATE, branch decrement —
-- is byte-identical to app_0017.
--
-- The two additions:
--   1. A stock_ledger insert with reason='issue_to_holding', holder_user_id set
--      to v_req.requested_by (the person who raised the request).
--   2. An upsert into staff_holdings for the same (branch, holder, product).
--
-- Holding is credited to the REQUESTER (v_req.requested_by), not the reviewer
-- (v_user_id). The reviewer acts on behalf of the requester.
--
-- Depends on: app_0017_fix_request_stock_race (base function)
--             app_0021_ledger_holder (holder_user_id column + reason values)
--             app_0022_staff_holdings (staff_holdings table)
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
     for update;                                    -- ← race fix from app_0017

    if coalesce(v_available, 0) < v_qty_approved then
      raise exception
        'insufficient stock for product % in branch % (on hand: %, requested: %)',
        v_req_line.product_id, v_req.branch_id,
        coalesce(v_available, 0), v_qty_approved;
    end if;

    -- ── Ledger: branch leg — stock leaves the branch ──────────────────────────
    -- Unchanged from app_0017. holder_user_id is NULL (branch movement).
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
    -- Unchanged from app_0017.
    update public.product_stock
       set quantity   = quantity - v_qty_approved,
           updated_at = now()
     where branch_id  = v_req.branch_id
       and product_id = v_req_line.product_id;

    -- ── NEW (app_0023): Holding leg — stock enters requester's personal holding ─
    -- Two writes, same transaction. Either both succeed or the whole function
    -- rolls back (§ 7 transactional integrity).
    --
    -- holder_user_id = v_req.requested_by: the person who raised the request
    -- receives the stock into their holding. The reviewer (v_user_id) is
    -- recorded as created_by for audit, not as the holder.

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
      v_req.organisation_id,
      v_req.branch_id,
      v_req_line.product_id,
      v_qty_approved,             -- stock ENTERS the holder
      'issue_to_holding',
      'stock_request',
      p_request_id,
      v_req.requested_by,
      v_user_id
    );

    insert into public.staff_holdings (
      organisation_id,
      branch_id,
      holder_user_id,
      product_id,
      quantity
    ) values (
      v_req.organisation_id,
      v_req.branch_id,
      v_req.requested_by,
      v_req_line.product_id,
      v_qty_approved
    )
    on conflict (branch_id, holder_user_id, product_id)
    do update
      set quantity   = staff_holdings.quantity + excluded.quantity,
          updated_at = now();

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

revoke all    on function public.review_stock_request(uuid, text, jsonb, text) from public;
grant execute on function public.review_stock_request(uuid, text, jsonb, text) to authenticated;
