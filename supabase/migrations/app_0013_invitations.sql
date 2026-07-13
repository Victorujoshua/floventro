-- ─────────────────────────────────────────────────────────────────────────────
-- app_0013_invitations.sql
-- Invitations table: email-based, token-gated, 7-day expiry, revocable.
-- Acceptance is handled entirely through the security-definer RPC in
-- app_0014 — invitees CANNOT read this table directly.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.invitations (
  id               uuid        primary key default gen_random_uuid(),
  organisation_id  uuid        not null references public.organisations(id) on delete cascade,
  branch_id        uuid        references public.branches(id) on delete cascade,
  -- null branch_id is valid for owner-role invites (org-wide, no branch scope)

  email            text        not null,
  -- stored and compared in lower-case; enforced via index expression + RPC

  role             text        not null check (role in ('owner','inventory','sales','internal_use')),

  token            text        not null unique default encode(gen_random_bytes(24), 'hex'),
  -- 24 random bytes → 48 hex chars; unguessable, URL-safe

  status           text        not null default 'pending'
                               check (status in ('pending','accepted','revoked','expired')),

  invited_by       uuid        references auth.users(id),
  -- the owner who created the invite

  expires_at       timestamptz not null,
  -- set by the inserting client / server action to now() + interval '7 days'

  accepted_at      timestamptz,
  accepted_by      uuid        references auth.users(id),
  -- the auth user who called accept_invitation(); may differ from the
  -- invited email if the user signed up with a different account, but
  -- the RPC enforces email match before allowing acceptance

  created_at       timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Fast token lookup (used by accept_invitation RPC on every acceptance call)
create index invitations_token_idx
  on public.invitations (token);

-- Efficient queries by org + status (owner's invite list, pending-count badge)
create index invitations_org_status_idx
  on public.invitations (organisation_id, status);

-- Lookup by invitee email (e.g. checking if a user has pending invites on login)
create index invitations_email_lower_idx
  on public.invitations (lower(email));

-- ── Partial unique: one PENDING invite per email+org+branch+role combination ─
-- Uses coalesce to treat NULL branch_id as a sentinel UUID so the expression
-- is not null and the unique constraint fires correctly for org-wide invites.
create unique index invitations_pending_unique
  on public.invitations (
    organisation_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(email),
    role
  )
  where status = 'pending';
-- Accepted/revoked/expired invites are excluded from the uniqueness check,
-- so the same email+role can be re-invited after a previous invite expires.
