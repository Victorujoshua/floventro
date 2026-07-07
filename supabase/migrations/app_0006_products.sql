-- Migration: app_0006_products
-- Products catalogue table. Products are org-scoped (shared across all branches).
-- Per-branch stock lives in product_stock, added in Phase 3.
-- Depends on: app_0001_core.sql (organisations table, set_updated_at function)

create table public.products (
  id               uuid        primary key default gen_random_uuid(),
  organisation_id  uuid        not null references public.organisations(id) on delete restrict,
  sku              text        not null,
  name             text        not null,
  description      text,
  unit_cost_cents  bigint,          -- nullable: last-known cost; historical costs live on invoice_lines
  reorder_point    integer     not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

-- updated_at trigger (reuses set_updated_at() from app_0001_core.sql)
create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- Partial unique index: SKU must be unique per org among non-deleted products
create unique index products_org_sku_unique
  on public.products (organisation_id, sku)
  where deleted_at is null;

-- Covering index for list queries filtered by org
create index products_organisation_id_idx
  on public.products (organisation_id)
  where deleted_at is null;
