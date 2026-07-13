-- ─────────────────────────────────────────────────────────────────────────────
-- app_0014_invitations_rls_and_rpc.sql
-- RLS on invitations (owner-only) + accept_invitation security-definer RPC.
--
-- Design:
--   • Owners can SELECT/INSERT/UPDATE their org's invitations.
--   • Invitees have NO direct access — they accept via the RPC only.
--     The RPC is security definer, so it reads invitations bypassing RLS.
--   • No DELETE policy; revocation sets status = 'revoked'.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.invitations enable row level security;

-- SELECT: org owners can read their invitations.
-- Non-members (including invitees) have no SELECT access; acceptance is
-- handled exclusively through accept_invitation() below.
create policy "owners can view org invitations"
  on public.invitations
  for select
  to authenticated
  using (
    organisation_id in (select public.user_owned_org_ids())
  );

-- INSERT: org owners can create invitations for their orgs.
create policy "owners can create invitations"
  on public.invitations
  for insert
  to authenticated
  with check (
    organisation_id in (select public.user_owned_org_ids())
  );

-- UPDATE: org owners can update (revoke) their org's invitations.
-- The USING clause restricts which rows are visible for update;
-- WITH CHECK ensures the row still belongs to an owned org after update.
create policy "owners can update invitations"
  on public.invitations
  for update
  to authenticated
  using (
    organisation_id in (select public.user_owned_org_ids())
  )
  with check (
    organisation_id in (select public.user_owned_org_ids())
  );

-- No DELETE policy — invites are soft-revoked, never hard-deleted.

-- ── accept_invitation RPC ─────────────────────────────────────────────────────
--
-- Called by an authenticated user who received an invite link containing the
-- token. Runs as security definer to:
--   1. Read the invitation row without RLS (invitee has no membership yet).
--   2. Write to memberships without being blocked by member-only RLS.
--
-- Returns the organisation_id the caller just joined, so the UI can set
-- the scope cookie and redirect to the dashboard.

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id   uuid := auth.uid();
  v_user_email text;
  v_invite    invitations%rowtype;
begin
  -- ── 1. Auth guard ─────────────────────────────────────────────────────────
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- ── 2. Resolve invite by token (RLS bypassed by security definer) ─────────
  select * into v_invite
    from public.invitations
   where token = p_token;

  if v_invite.id is null then
    raise exception 'invite not found';
  end if;

  -- ── 3. Status check ───────────────────────────────────────────────────────
  if v_invite.status <> 'pending' then
    raise exception 'invite is no longer valid';
  end if;

  -- ── 4. Expiry check ───────────────────────────────────────────────────────
  if v_invite.expires_at < now() then
    -- Tidy up so the owner sees "Expired" in the invite list.
    update public.invitations
       set status = 'expired'
     where id = v_invite.id;
    raise exception 'invite has expired';
  end if;

  -- ── 5. Email match ────────────────────────────────────────────────────────
  -- Fetch the accepting user's email from auth.users.
  -- set search_path = public does not affect auth schema visibility; auth.users
  -- is always accessible to security-definer functions.
  select lower(email) into v_user_email
    from auth.users
   where id = v_user_id;

  if v_user_email is distinct from lower(v_invite.email) then
    raise exception 'this invite was sent to a different email address';
  end if;

  -- ── 6. Duplicate membership guard ─────────────────────────────────────────
  -- If the exact same scope (user + org + branch + role) already exists as an
  -- active membership, skip the insert and just mark the invite accepted.
  -- coalesce converts NULL branch_id to a sentinel so the comparison is
  -- null-safe without needing IS NOT DISTINCT FROM.
  if exists (
    select 1
      from public.memberships
     where user_id         = v_user_id
       and organisation_id = v_invite.organisation_id
       and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(v_invite.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and role            = v_invite.role
       and deleted_at      is null
  ) then
    update public.invitations
       set status      = 'accepted',
           accepted_at = now(),
           accepted_by = v_user_id
     where id = v_invite.id;
    return v_invite.organisation_id;
  end if;

  -- ── 7. Create membership ──────────────────────────────────────────────────
  insert into public.memberships (user_id, organisation_id, branch_id, role)
  values (v_user_id, v_invite.organisation_id, v_invite.branch_id, v_invite.role);

  -- ── 8. Mark invite accepted ───────────────────────────────────────────────
  update public.invitations
     set status      = 'accepted',
         accepted_at = now(),
         accepted_by = v_user_id
   where id = v_invite.id;

  return v_invite.organisation_id;
end;
$$;

-- Restrict execution to authenticated users only (no anonymous acceptance).
revoke all    on function public.accept_invitation(text) from public;
grant  execute on function public.accept_invitation(text) to authenticated;
