create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  company text,
  role text,
  branch_count text,
  referrer text,
  utm_source text, utm_medium text, utm_campaign text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index waitlist_created_at_idx on public.waitlist(created_at desc);

alter table public.waitlist enable row level security;
