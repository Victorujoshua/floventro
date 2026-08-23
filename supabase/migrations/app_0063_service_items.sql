-- ─────────────────────────────────────────────────────────────────────────────
-- app_0063_service_items.sql
--
-- Phase 1 of Service Items: measurements catalog + service_items catalog.
-- SCHEMA ONLY — no changes to any existing table, no engine touch.
-- products, staff_holdings, cost_layers, product_cost_state, cogs_allocations,
-- add_service_consumption are all untouched.
--
-- New tables:
--   measurements   — seeded system catalog (6 rows) + org-scoped custom entries.
--                    System rows: organisation_id IS NULL, is_system = true.
--                    Custom rows: organisation_id = org id, is_system = false.
--   service_items  — org-scoped catalog of items used in services.
--                    category: product | supply | equipment.
--                    amount_cents: cost of the package (or flat fee for equipment).
--                    unit_cost_per_measurement = amount_cents / package_size is
--                    computed in the app layer — NOT stored.
--
-- RLS helpers reused (no redefinition):
--   user_member_org_ids()        — app_0007: any member → read
--   user_service_write_org_ids() — app_0055: owner/inventory/admin/sales → write
--
-- Depends on: app_0001_core (organisations, set_updated_at)
--             app_0006_products (products — optional FK from service_items.product_id)
--             app_0007_products_rls (user_member_org_ids)
--             app_0055_service_types_sales_write (user_service_write_org_ids)
-- ─────────────────────────────────────────────────────────────────────────────


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 1. measurements
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.measurements (
  id              uuid        primary key default gen_random_uuid(),
  -- NULL = system seed shared across all orgs; NOT NULL = org-scoped custom row.
  organisation_id uuid        references public.organisations(id) on delete restrict,
  name            text        not null,
  symbol          text,
  -- is_system = true for the 6 seeded rows only. The RLS INSERT policy also
  -- enforces is_system = false on all user-created rows at the DB layer.
  is_system       boolean     not null default false,
  created_by      uuid        references auth.users(id),
  created_at      timestamptz not null default now()
);

-- System-seed uniqueness: no two global rows may share a name.
create unique index measurements_name_system_unique
  on public.measurements (lower(name))
  where organisation_id is null;

-- Org-custom uniqueness: no two rows in the same org may share a name.
create unique index measurements_name_org_unique
  on public.measurements (organisation_id, lower(name))
  where organisation_id is not null;

create index measurements_org_idx on public.measurements (organisation_id);


-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.measurements enable row level security;
alter table public.measurements force row level security;

-- SELECT: system rows (org NULL) visible to everyone authenticated;
--         org rows visible to members of that org.
create policy "measurements_select"
  on public.measurements for select
  using (
    organisation_id is null
    or organisation_id in (select public.user_member_org_ids())
  );

-- INSERT: only custom (non-system) rows in the caller's own org.
--         is_system = false is enforced here so no user can insert a system seed.
create policy "measurements_insert"
  on public.measurements for insert
  with check (
    is_system = false
    and organisation_id is not null
    and organisation_id in (select public.user_service_write_org_ids())
  );

-- UPDATE: only custom rows the org owns; cannot touch system seeds.
create policy "measurements_update"
  on public.measurements for update
  using (
    is_system = false
    and organisation_id is not null
    and organisation_id in (select public.user_service_write_org_ids())
  )
  with check (
    is_system = false
    and organisation_id is not null
    and organisation_id in (select public.user_service_write_org_ids())
  );

-- DELETE: same guard as UPDATE.
create policy "measurements_delete"
  on public.measurements for delete
  using (
    is_system = false
    and organisation_id is not null
    and organisation_id in (select public.user_service_write_org_ids())
  );

revoke all   on table public.measurements from public;
grant select, insert, update, delete on table public.measurements to authenticated;


-- ── Seed system measurements ──────────────────────────────────────────────────
-- organisation_id NULL = global; is_system = true; created_by NULL (no user created them).

insert into public.measurements (name, symbol, is_system, organisation_id, created_by) values
  ('flat_rate', null, true, null, null),
  ('ml',        'ml', true, null, null),
  ('cl',        'cl', true, null, null),
  ('cm',        'cm', true, null, null),
  ('pint',      'pt', true, null, null),
  ('liter',     'L',  true, null, null);


-- ╔══════════════════════════════════════════════════════════════════════════════
-- ║ 2. service_items
-- ╚══════════════════════════════════════════════════════════════════════════════

create table public.service_items (
  id              uuid        primary key default gen_random_uuid(),
  organisation_id uuid        not null references public.organisations(id) on delete restrict,
  name            text        not null,
  -- category drives UI behavior:
  --   product   = consumable; optionally linked to an inventory product via product_id.
  --   supply    = consumable; no inventory link (tissue, syringe, cotton, etc.).
  --   equipment = reusable; flat per-session fee, no stock drain, not requestable.
  category        text        not null check (category in ('product', 'supply', 'equipment')),
  -- measurement_id: the unit this item is measured in.
  -- Equipment and flat-rate supplies reference the 'flat_rate' system measurement.
  measurement_id  uuid        references public.measurements(id),
  -- package_size: quantity in measurement units per purchase/supply unit (e.g. 400 for 400 ml).
  -- NULL for flat_rate items (equipment, or a supply with no proportional sizing).
  -- Must be > 0 when set.
  package_size    numeric     check (package_size is null or package_size > 0),
  -- amount_cents:
  --   consumable → cost of the package (e.g. ₦20,000 for 400 ml bottle).
  --   equipment  → flat fee per session.
  -- unit_cost_per_measurement = amount_cents / package_size is derived in the app;
  -- NOT stored here to avoid stale denormalisation.
  amount_cents    bigint      not null check (amount_cents >= 0),
  -- product_id: optional link to an inventory product (meaningful for category='product').
  -- Records intent ("this Phollicles item IS Mandelactone in the products catalog").
  -- No data flow in Phase 1/2; Phase 3 will use this for ml-based stock drain.
  product_id      uuid        references public.products(id),
  is_active       boolean     not null default true,
  created_by      uuid        not null references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create trigger service_items_updated_at
  before update on public.service_items
  for each row execute function public.set_updated_at();

-- Names unique per org among non-deleted items.
create unique index service_items_name_org_unique
  on public.service_items (organisation_id, lower(name))
  where deleted_at is null;

create index service_items_org_idx         on public.service_items (organisation_id)              where deleted_at is null;
create index service_items_category_idx    on public.service_items (organisation_id, category)    where deleted_at is null;
create index service_items_measurement_idx on public.service_items (measurement_id);
create index service_items_product_idx     on public.service_items (product_id)                   where product_id is not null;


-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.service_items enable row level security;
alter table public.service_items force row level security;

-- SELECT: all org members (including internal_use) read the catalog.
create policy "service_items_select"
  on public.service_items for select
  using (organisation_id in (select public.user_member_org_ids()));

-- INSERT / UPDATE: owner / inventory / admin / sales only.
create policy "service_items_insert"
  on public.service_items for insert
  with check (organisation_id in (select public.user_service_write_org_ids()));

create policy "service_items_update"
  on public.service_items for update
  using  (organisation_id in (select public.user_service_write_org_ids()))
  with check (organisation_id in (select public.user_service_write_org_ids()));

revoke all   on table public.service_items from public;
grant select, insert, update on table public.service_items to authenticated;


notify pgrst, 'reload schema';
