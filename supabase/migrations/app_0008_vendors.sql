-- Migration: app_0008_vendors
-- Vendors table. Vendors are BRANCH-scoped — each branch has its own vendor list.
-- Contrast with products (org-scoped). Per BUILD.md task 2.2.
-- Depends on: app_0001_core.sql (organisations, branches tables, set_updated_at function)

create table public.vendors (
  id                  uuid        primary key default gen_random_uuid(),
  organisation_id     uuid        not null references public.organisations(id) on delete restrict,
  branch_id           uuid        not null references public.branches(id) on delete restrict,
  name                text        not null,
  contact_person      text,
  phone               text,
  email               text,
  tin                 text,
  cac_registration    text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

-- updated_at trigger (reuses set_updated_at() from app_0001_core.sql)
create trigger vendors_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

-- Partial unique index: vendor name must be unique per branch among non-deleted vendors
create unique index vendors_branch_name_unique
  on public.vendors (branch_id, name)
  where deleted_at is null;

-- Index for branch-scoped list queries
create index vendors_branch_id_idx
  on public.vendors (branch_id)
  where deleted_at is null;

-- Index for org-level rollup queries (owner cross-branch views)
create index vendors_organisation_id_idx
  on public.vendors (organisation_id)
  where deleted_at is null;
