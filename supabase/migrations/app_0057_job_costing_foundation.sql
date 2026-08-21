-- ─────────────────────────────────────────────────────────────────────────────
-- app_0057_job_costing_foundation.sql
--
-- Phases 1–3 of Job Costing: client identity, plan catalog, subscriptions.
-- record_service_usage is NOT modified here — that is Phase 4.
--
-- New tables:
--   clients       — org-scoped client identity with optional unique member_id
--   plans         — service plan catalog (single | package; type is UI-hint only)
--   plan_lines    — one service × N sessions per line, child of plans (cascade)
--   client_plans  — subscription: plan + price paid + sessions used/total tracker
--
-- Extends:
--   service_records — ADD client_id uuid references clients(id), nullable.
--                     Existing rows keep free-text customer_name/phone/member_id.
--                     Phase 4 RPC will set client_id on new plan-linked sessions.
--
-- RLS helpers reused (already defined, no redefinition):
--   user_member_org_ids()        — app_0007: any org member → read access
--   user_service_write_org_ids() — app_0055: owner/inventory/admin/sales → write
--
-- Depends on: app_0001_core (set_updated_at, organisations)
--             app_0007_products_rls (user_member_org_ids)
--             app_0026_service_usage (service_types table — plan_lines FK)
--             app_0055_service_types_sales_write (user_service_write_org_ids)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. clients
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.clients (
  id              uuid        primary key default gen_random_uuid(),
  organisation_id uuid        not null references public.organisations (id),
  name            text        not null,
  phone           text,
  email           text,
  -- member_id: optional human-readable client ID (e.g. "MEM-001").
  -- Unique within org (case-insensitive) when set. Used as a lookup key.
  -- NOT the FK that links subscriptions — client_plans.client_id → clients.id is.
  member_id       text,
  created_by      uuid        not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create trigger set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- Case-insensitive uniqueness, trimming whitespace, among non-deleted clients.
create unique index clients_member_id_org_unique
  on public.clients (organisation_id, lower(trim(member_id)))
  where member_id is not null and deleted_at is null;

create index clients_org_idx  on public.clients (organisation_id);
create index clients_name_idx on public.clients (organisation_id, lower(name));

-- ── RLS ────────────────────────────────────────────────────────────────────────

alter table public.clients enable row level security;
alter table public.clients force row level security;

create policy "clients: member read"
  on public.clients for select
  using (organisation_id in (select public.user_member_org_ids()));

create policy "clients: service write insert"
  on public.clients for insert
  with check (organisation_id in (select public.user_service_write_org_ids()));

create policy "clients: service write update"
  on public.clients for update
  using  (organisation_id in (select public.user_service_write_org_ids()))
  with check (organisation_id in (select public.user_service_write_org_ids()));

-- ── Grants ─────────────────────────────────────────────────────────────────────

revoke all on table public.clients from public;
grant select, insert, update on table public.clients to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. plans
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.plans (
  id              uuid        primary key default gen_random_uuid(),
  organisation_id uuid        not null references public.organisations (id),
  name            text        not null,
  -- type is a UI hint only — not load-bearing in queries. Both types are stored
  -- identically: plan_lines rows determine the services and session counts.
  -- 'single'  = one service × N sessions (plan_lines has 1 row)
  -- 'package' = multiple services bundled  (plan_lines has N rows)
  type            text        not null check (type in ('single', 'package')),
  price_cents     bigint      not null default 0 check (price_cents >= 0),
  is_active       boolean     not null default true,
  created_by      uuid        not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create trigger set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

create unique index plans_name_org_unique
  on public.plans (organisation_id, lower(trim(name)))
  where deleted_at is null;

create index plans_org_idx on public.plans (organisation_id);

-- ── RLS ────────────────────────────────────────────────────────────────────────

alter table public.plans enable row level security;
alter table public.plans force row level security;

create policy "plans: member read"
  on public.plans for select
  using (organisation_id in (select public.user_member_org_ids()));

create policy "plans: service write insert"
  on public.plans for insert
  with check (organisation_id in (select public.user_service_write_org_ids()));

create policy "plans: service write update"
  on public.plans for update
  using  (organisation_id in (select public.user_service_write_org_ids()))
  with check (organisation_id in (select public.user_service_write_org_ids()));

-- ── Grants ─────────────────────────────────────────────────────────────────────

revoke all on table public.plans from public;
grant select, insert, update on table public.plans to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 3. plan_lines
-- ╚══════════════════════════════════════════════════════════════════════════════
--
-- No RLS recursion concern: plan_lines policies reference plans (different table)
-- not plan_lines itself, so no self-referential policy loop.

create table public.plan_lines (
  id              uuid    primary key default gen_random_uuid(),
  plan_id         uuid    not null references public.plans (id) on delete cascade,
  service_type_id uuid    not null references public.service_types (id),
  session_count   integer not null check (session_count > 0),
  created_at      timestamptz not null default now()
  -- Intentionally no updated_at — replace-all pattern on edit (delete + re-insert).
);

create index plan_lines_plan_idx on public.plan_lines (plan_id);

-- ── RLS ────────────────────────────────────────────────────────────────────────

alter table public.plan_lines enable row level security;
alter table public.plan_lines force row level security;

create policy "plan_lines: member read"
  on public.plan_lines for select
  using (
    plan_id in (
      select id from public.plans
       where organisation_id in (select public.user_member_org_ids())
    )
  );

create policy "plan_lines: service write insert"
  on public.plan_lines for insert
  with check (
    plan_id in (
      select id from public.plans
       where organisation_id in (select public.user_service_write_org_ids())
    )
  );

-- DELETE used for the replace-all edit pattern: delete old lines, insert new.
create policy "plan_lines: service write delete"
  on public.plan_lines for delete
  using (
    plan_id in (
      select id from public.plans
       where organisation_id in (select public.user_service_write_org_ids())
    )
  );

-- ── Grants ─────────────────────────────────────────────────────────────────────

revoke all on table public.plan_lines from public;
grant select, insert, delete on table public.plan_lines to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 4. client_plans  (subscriptions)
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.client_plans (
  id               uuid    primary key default gen_random_uuid(),
  organisation_id  uuid    not null references public.organisations (id),
  client_id        uuid    not null references public.clients (id),
  -- plan_id nullable: allows ad-hoc subscriptions (no catalog plan) for Phase 4+.
  -- For Phase 1–3 UI, all subscriptions are linked to a plan.
  plan_id          uuid    references public.plans (id),
  -- sessions_total: snapshotted from sum(plan_lines.session_count) at subscribe time.
  -- Immutable after creation — the client's contract is frozen at the purchase date.
  sessions_total   integer not null check (sessions_total > 0),
  -- sessions_used: incremented by record_service_usage RPC (Phase 4, security-definer).
  sessions_used    integer not null default 0 check (sessions_used >= 0),
  -- price_paid_cents: what the client ACTUALLY paid (may differ from plans.price_cents).
  -- session_revenue_cents = price_paid_cents / sessions_total (computed in Phase 4).
  price_paid_cents bigint  not null check (price_paid_cents >= 0),
  purchased_on     date    not null default current_date,
  created_by       uuid    not null,
  created_at       timestamptz not null default now(),
  constraint client_plans_sessions_check check (sessions_used <= sessions_total)
);

create index client_plans_org_idx    on public.client_plans (organisation_id);
create index client_plans_client_idx on public.client_plans (client_id);
create index client_plans_plan_idx   on public.client_plans (plan_id);

-- ── RLS ────────────────────────────────────────────────────────────────────────

alter table public.client_plans enable row level security;
alter table public.client_plans force row level security;

create policy "client_plans: member read"
  on public.client_plans for select
  using (organisation_id in (select public.user_member_org_ids()));

create policy "client_plans: service write insert"
  on public.client_plans for insert
  with check (organisation_id in (select public.user_service_write_org_ids()));

-- UPDATE needed for Phase 4 RPC (security-definer, bypasses RLS when incrementing
-- sessions_used) and for management corrections from the admin UI.
create policy "client_plans: service write update"
  on public.client_plans for update
  using  (organisation_id in (select public.user_service_write_org_ids()))
  with check (organisation_id in (select public.user_service_write_org_ids()));

-- ── Grants ─────────────────────────────────────────────────────────────────────

revoke all on table public.client_plans from public;
grant select, insert, update on table public.client_plans to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 5. service_records — add client_id (Phase 1 column only)
-- ╚══════════════════════════════════════════════════════════════════════════════
-- Nullable: pre-existing rows retain their free-text customer_name/phone/member_id.
-- Phase 4 RPC extension will populate this for new plan-linked sessions.
-- client_plan_id and session_revenue_cents columns are added in Phase 4.

alter table public.service_records
  add column if not exists client_id uuid references public.clients (id);

create index if not exists service_records_client_idx
  on public.service_records (client_id);


-- ── Reload PostgREST schema cache ─────────────────────────────────────────────

notify pgrst, 'reload schema';
