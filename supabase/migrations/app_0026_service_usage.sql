-- ─────────────────────────────────────────────────────────────────────────────
-- app_0026_service_usage.sql
--
-- Introduces service usage tracking: a practitioner consumes products from their
-- own holding during a client service (e.g. a treatment, installation, session).
--
-- Tables:
--   service_types       — org-scoped catalog of service names (what kind of
--                         service was rendered). Soft-delete via deleted_at.
--   service_records     — one row per service event. Immutable (no updated_at /
--                         deleted_at). Corrections via future reversal entries.
--   service_consumption — one row per product consumed in a service event.
--                         Immutable for the same reason.
--
-- RLS helpers reused (already exist, no redefinition needed):
--   user_member_org_ids()       — app_0007: any member of an org (used for
--                                 service_types SELECT)
--   user_product_write_org_ids()— app_0007: owner/inventory of an org (used for
--                                 service_types INSERT/UPDATE)
--   user_vendor_read_branch_ids()  — app_0009: any role in owned-org branches
--                                    (membership gate inside record_service_usage)
--   user_vendor_write_branch_ids() — app_0009: owner/inventory branches (manager
--                                    half of service_records SELECT policy)
--
-- New helper defined here:
--   user_readable_service_ids() — mirrors user_readable_sale_ids() (app_0024).
--                                  Avoids RLS-on-RLS for service_consumption.
--
-- New RPC:
--   record_service_usage(uuid, uuid, text, text, date, bigint, text, jsonb)
--     → uuid (the new service_record id)
--   Mirrors record_sale in structure. Key differences:
--     • reason = 'usage' (not 'sale') — satisfies holder_user_id NOT NULL constraint
--     • no unit_price_cents per consumed product (products are consumed, not priced here)
--     • p_service_fee_cents is the fee for the service itself (nullable)
--     • performed_by is always auth.uid() — a practitioner records their own service
--
-- Depends on: app_0021_ledger_holder.sql (the 'usage' reason in the constraint)
--             app_0022_staff_holdings.sql (staff_holdings table + FOR UPDATE pattern)
--             app_0024_sales.sql          (user_readable_sale_ids() as reference)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. service_types
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.service_types (
  id              uuid        primary key default gen_random_uuid(),
  organisation_id uuid        not null references public.organisations (id),
  name            text        not null,
  description     text,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  created_by      uuid        not null
);

-- Case-insensitive uniqueness within an org (only among non-deleted types)
create unique index service_types_name_org_unique
  on public.service_types (organisation_id, lower(name))
  where deleted_at is null;

-- Trigger: keep updated_at current. set_updated_at() defined in app_0001_core.sql.
create trigger set_updated_at
  before update on public.service_types
  for each row execute function public.set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────────

alter table public.service_types enable row level security;
alter table public.service_types force row level security;

-- All org members see the active service catalogue (same access model as products)
create policy "service_types: member read"
  on public.service_types
  for select
  using (organisation_id in (select public.user_member_org_ids()));

-- Only owner / inventory members may create or update service types
create policy "service_types: owner/inventory write"
  on public.service_types
  for insert
  with check (organisation_id in (select public.user_product_write_org_ids()));

create policy "service_types: owner/inventory update"
  on public.service_types
  for update
  using  (organisation_id in (select public.user_product_write_org_ids()))
  with check (organisation_id in (select public.user_product_write_org_ids()));

-- ── Grants ─────────────────────────────────────────────────────────────────────

revoke all on table public.service_types from public;
grant select, insert, update on table public.service_types to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. service_records
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.service_records (
  id                uuid        primary key default gen_random_uuid(),
  organisation_id   uuid        not null references public.organisations (id),
  branch_id         uuid        not null references public.branches (id),
  service_type_id   uuid        not null references public.service_types (id),
  performed_by      uuid        not null,   -- auth.uid() at time of recording
  customer_name       text,
  customer_phone      text,
  performed_on      date        not null default current_date,
  service_fee_cents bigint      check (service_fee_cents is null or service_fee_cents >= 0),
  note              text,
  created_at        timestamptz not null default now(),
  created_by        uuid        not null
  -- Intentionally no updated_at, no deleted_at.
  -- This table is immutable: once recorded, a service event is never modified.
  -- Corrections are modelled as future reversal records (out of scope here).
);

create index service_records_org_idx       on public.service_records (organisation_id);
create index service_records_branch_idx    on public.service_records (branch_id);
create index service_records_performer_idx on public.service_records (performed_by);
create index service_records_date_idx      on public.service_records (performed_on desc);

-- ── user_readable_service_ids helper (mirrors user_readable_sale_ids) ─────────
--
-- Security-definer helper that returns IDs of service_records the caller may
-- read. Defined before the RLS policy that references it and before
-- service_consumption (whose policy uses it to avoid RLS-on-RLS).

create or replace function public.user_readable_service_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select id
    from public.service_records
   where performed_by = auth.uid()
      or branch_id in (select public.user_vendor_write_branch_ids());
$$;

revoke all    on function public.user_readable_service_ids() from public;
grant execute on function public.user_readable_service_ids() to authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────────────

alter table public.service_records enable row level security;
alter table public.service_records force row level security;

-- Practitioners see their own records; owner/inventory see all in their branches.
-- Using the security-definer helper avoids RLS recursion (the helper queries
-- service_records as a security-definer function, bypassing RLS internally,
-- then returns only the IDs the caller is allowed to see).
create policy "service_records: readable by performer or manager"
  on public.service_records
  for select
  using (id in (select public.user_readable_service_ids()));

-- No INSERT / UPDATE / DELETE policies — all writes go through the
-- record_service_usage security-definer RPC. A direct INSERT by an authenticated
-- user will be rejected (no matching policy).

-- ── Grants ─────────────────────────────────────────────────────────────────────

revoke all on table public.service_records from public;
grant select on table public.service_records to authenticated;
-- No insert/update/delete grant — mutations via record_service_usage only.


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 3. service_consumption
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.service_consumption (
  id                uuid        primary key default gen_random_uuid(),
  service_record_id uuid        not null references public.service_records (id),
  product_id        uuid        not null references public.products (id),
  quantity          integer     not null check (quantity > 0),
  created_at        timestamptz not null default now()
  -- Intentionally no updated_at, no deleted_at — immutable.
);

create index service_consumption_record_idx  on public.service_consumption (service_record_id);
create index service_consumption_product_idx on public.service_consumption (product_id);

-- ── RLS ────────────────────────────────────────────────────────────────────────

alter table public.service_consumption enable row level security;
alter table public.service_consumption force row level security;

-- Consumption rows are visible if and only if the parent service_record is.
-- Using user_readable_service_ids() avoids joining through service_records under
-- its own RLS policy, which would cause an RLS-on-RLS recursion.
create policy "service_consumption: visible with parent record"
  on public.service_consumption
  for select
  using (service_record_id in (select public.user_readable_service_ids()));

-- No INSERT / UPDATE / DELETE policies — all writes via record_service_usage RPC.

-- ── Grants ─────────────────────────────────────────────────────────────────────

revoke all on table public.service_consumption from public;
grant select on table public.service_consumption to authenticated;


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 4. record_service_usage RPC
-- ╚══════════════════════════════════════════════════════════════════════════════

create or replace function public.record_service_usage(
  p_branch_id         uuid,
  p_service_type_id   uuid,
  p_customer_name       text,
  p_customer_phone      text,
  p_performed_on      date,
  p_service_fee_cents bigint,   -- nullable: fee charged for the service itself
  p_note              text,
  p_lines             jsonb     -- array of { product_id, quantity } — no price field
) returns uuid                  -- the new service_record id
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid := auth.uid();
  v_org_id     uuid;
  v_record_id  uuid;
  v_line       jsonb;
  v_product_id uuid;
  v_qty        integer;
  v_held       integer;
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
  -- The practitioner must be a member of this branch. Whether they have enough
  -- holding to consume is checked per product below.
  if p_branch_id not in (select public.user_vendor_read_branch_ids()) then
    raise exception 'not authorised to record service usage in this branch';
  end if;

  -- ── Service type must belong to this org and be active ─────────────────────────
  if not exists (
    select 1
      from public.service_types
     where id              = p_service_type_id
       and organisation_id = v_org_id
       and is_active       = true
       and deleted_at      is null
  ) then
    raise exception 'service type not found or inactive';
  end if;

  -- ── Lines required ────────────────────────────────────────────────────────────
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'service usage must consume at least one product';
  end if;

  -- ── Service fee validation ────────────────────────────────────────────────────
  if p_service_fee_cents is not null and p_service_fee_cents < 0 then
    raise exception 'service fee cannot be negative';
  end if;

  -- ── Insert service record header ──────────────────────────────────────────────
  -- performed_by is always auth.uid(). A practitioner records their own service —
  -- the same user whose holding will be decremented in the lines loop below.
  insert into public.service_records (
    organisation_id,
    branch_id,
    service_type_id,
    performed_by,
    customer_name,
    customer_phone,
    performed_on,
    service_fee_cents,
    note,
    created_by
  ) values (
    v_org_id,
    p_branch_id,
    p_service_type_id,
    v_user_id,
    nullif(trim(p_customer_name),  ''),
    nullif(trim(p_customer_phone), ''),
    coalesce(p_performed_on, current_date),
    p_service_fee_cents,
    nullif(trim(p_note), ''),
    v_user_id
  )
  returning id into v_record_id;

  -- ── Process each line ─────────────────────────────────────────────────────────
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_product_id := (v_line->>'product_id')::uuid;
    v_qty        := (v_line->>'quantity')::integer;

    -- ── Validate inputs ───────────────────────────────────────────────────────
    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be greater than 0';
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
    -- FOR UPDATE on the practitioner's (branch, holder, product) row.
    -- Serializes concurrent service recordings by the same practitioner for the
    -- same product in the same branch — the second transaction blocks here and
    -- re-reads the already-decremented quantity after the first commits.
    select coalesce(quantity, 0) into v_held
      from public.staff_holdings
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id
     for update;

    if coalesce(v_held, 0) < v_qty then
      raise exception
        'insufficient holding for product % (holding: %, consuming: %)',
        v_product_id, coalesce(v_held, 0), v_qty;
    end if;

    -- ── Insert service_consumption row ────────────────────────────────────────
    insert into public.service_consumption (
      service_record_id,
      product_id,
      quantity
    ) values (
      v_record_id,
      v_product_id,
      v_qty
    );

    -- ── Ledger: usage OUT of holding ──────────────────────────────────────────
    -- reason = 'usage', holder_user_id = v_user_id (the practitioner).
    -- The live stock_ledger_holder_consistency constraint REQUIRES holder_user_id
    -- to be non-null for reason = 'usage'. This insert always provides it.
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
      -v_qty,           -- stock leaves the practitioner's holding
      'usage',
      'service_record',
      v_record_id,
      v_user_id,        -- the practitioner IS the holder
      v_user_id
    );

    -- ── Decrement staff_holdings ──────────────────────────────────────────────
    update public.staff_holdings
       set quantity   = quantity - v_qty,
           updated_at = now()
     where branch_id      = p_branch_id
       and holder_user_id = v_user_id
       and product_id     = v_product_id;

  end loop;

  return v_record_id;
end;
$$;

revoke all    on function public.record_service_usage(uuid, uuid, text, text, date, bigint, text, jsonb) from public;
grant execute on function public.record_service_usage(uuid, uuid, text, text, date, bigint, text, jsonb) to authenticated;
