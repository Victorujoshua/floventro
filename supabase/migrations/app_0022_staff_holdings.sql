-- ─────────────────────────────────────────────────────────────────────────────
-- app_0022_staff_holdings.sql
--
-- Creates staff_holdings — the personal-holding cache, mirroring product_stock.
--
--   product_stock    → caches branch on-hand quantity per (branch, product)
--   staff_holdings   → caches holder on-hand quantity per (branch, holder, product)
--
-- Written ONLY by security-definer RPCs. No direct user write policies,
-- identical to the product_stock lockdown in app_0010.
--
-- The branch_id column is included in the unique key because a staffer can
-- hold items issued from different branches (if they have memberships in
-- multiple branches). Stock is always returned to the issuing branch.
--
-- Depends on: app_0001_core (organisations, branches, set_updated_at)
--             app_0009_vendors_rls (user_vendor_write_branch_ids helper)
--             app_0021_ledger_holder (establishes the holder concept)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.staff_holdings (
  id               uuid        primary key default gen_random_uuid(),
  organisation_id  uuid        not null references public.organisations(id) on delete restrict,
  branch_id        uuid        not null references public.branches(id)       on delete restrict,
  holder_user_id   uuid        not null references auth.users(id),
  product_id       uuid        not null references public.products(id)       on delete restrict,
  quantity         integer     not null default 0 check (quantity >= 0),
  updated_at       timestamptz not null default now(),
  unique (branch_id, holder_user_id, product_id)
);

create trigger staff_holdings_updated_at
  before update on public.staff_holdings
  for each row execute function public.set_updated_at();

create index staff_holdings_holder_idx
  on public.staff_holdings (holder_user_id);

create index staff_holdings_branch_idx
  on public.staff_holdings (branch_id);


-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table public.staff_holdings enable row level security;

-- SELECT: a staffer reads their own holding. Owner and inventory members read
-- all holdings in any branch they manage (user_vendor_write_branch_ids returns
-- branch IDs for which the caller has owner or inventory role — same helper
-- used by review_stock_request and adjust_stock).
create policy "staff_holdings_select"
  on public.staff_holdings
  for select
  using (
    holder_user_id = auth.uid()
    or branch_id in (select public.user_vendor_write_branch_ids())
  );

-- No INSERT / UPDATE / DELETE policies.
-- All writes are reserved for security-definer RPCs:
--   review_stock_request (app_0023) — issues stock into holding
--   record_sale (Phase 6.2)         — consumes from holding
--   record_usage (Phase 6.3)        — consumes from holding
--   return_to_branch RPC (future)   — returns stock from holding
