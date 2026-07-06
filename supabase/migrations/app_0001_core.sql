-- Migration: app_0001_core
-- Creates the multi-tenant foundation: organisations, branches, memberships.
-- Also creates the set_updated_at() trigger function and applies it.
-- Depends on: pgcrypto extension (created here), auth.users (Supabase Auth).

-- Enable required extensions
create extension if not exists "pgcrypto";

-- Organisations (tenants)
create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country_code text not null default 'NG',
  currency text not null default 'NGN',
  timezone text not null default 'Africa/Lagos',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Branches (aka stores)
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organisation_id, name)
);

-- Roles enum (text with check for flexibility)
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,   -- null for owner memberships that span all branches
  role text not null check (role in ('owner', 'inventory', 'sales', 'internal_use')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, organisation_id, branch_id, role)
);

-- updated_at triggers
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger organisations_updated_at before update on public.organisations
  for each row execute function public.set_updated_at();
create trigger branches_updated_at before update on public.branches
  for each row execute function public.set_updated_at();

-- Indexes
create index memberships_user_id_idx on public.memberships(user_id) where deleted_at is null;
create index memberships_organisation_id_idx on public.memberships(organisation_id) where deleted_at is null;
create index branches_organisation_id_idx on public.branches(organisation_id) where deleted_at is null;
