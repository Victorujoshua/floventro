# Floventro App — Build Plan

> This is the app build plan. Landing page is done and lives at repo root.
> Deployment architecture: **Option B — two Vercel projects sharing one repo** (see CLAUDE.md § 12).
> Each phase ends with a demoable checkpoint. Do not auto-advance.
> Later phases (3-9) are sketched only. We'll write detailed prompts when we get there.

---

## Working principles (read every session)

1. **Multi-tenant safety first.** Every table has RLS. Every policy is tested with a scoped user before merging.
2. **Stock is money.** Every stock movement in a Postgres transaction, wrapped in an RPC. Never chained client-side.
3. **Small, reviewable steps.** Each task in a phase should fit in one Claude Code session and one review pass.
4. **Types before code.** After every migration, regenerate `types/supabase.ts` before writing queries.
5. **Test the RLS.** After every migration, write a quick verification query as a scoped user and confirm the expected rows are returned/denied.

---

## Phase overview

| Phase | What ships | Est. time | Status |
|-------|-----------|-----------|--------|
| 1     | Auth + Organisation + Branch + role scaffolding. Owner can sign up, create org, create first branch, see empty dashboard. | 5-7 days | Detailed below |
| 2     | Product catalogue + vendor registry. Owner and Inventory can create products and vendors. Still no stock movement. | 3-4 days | Detailed below |
| 3     | Vendor invoices → stock arrives. First real value. Inventory records invoice, stock ledger records receipts, dashboard shows stock counts and outstanding balances. | 5-7 days | Sketched |
| 4     | Team invites, member acceptance, role-based routing. Sales/Internal Use members can be invited and land in their own workspaces (empty). | 3-4 days | Sketched |
| 5     | Internal requests (Sales/Internal Use → Inventory). Approve/partial/reject flow. Stock moves between team holdings. | 5-7 days | Sketched |
| 6     | Customer sales (Sales) and service usage (Internal Use). Customer and client records build up. Stock consumed. | 5-7 days | Sketched |
| 7     | Inter-branch transfers. Treated as vendor-invoice-on-receiving-side. Second branch becomes meaningful. | 4-5 days | Sketched |
| 8     | Owner cross-branch dashboard. Rollups, drill-down, real-time totals. Sentry + Analytics. | 4-5 days | Sketched |
| 9     | Polish: empty states, error boundaries, mobile responsiveness, accessibility pass, edge cases. | 5-7 days | Sketched |

**Total realistic timeline: 8–12 weeks focused work.** Do not compress this. Each phase's checkpoint is the gate.

---

# PHASE 1 — Auth, Organisation, Branch, Role Scaffolding

**Goal:** Owner can create an account, create their organisation, create their first branch, and land on an empty dashboard scoped to that org + branch. All plumbing for multi-tenancy is in place before any product data exists.

**Checkpoint:** Sign up as two different users → each can only see their own org. Try to query the other org's branches via Supabase directly → RLS denies. Sidebar shows the current org/branch/role. Log out works. Both work locally on `localhost:3000`.

---

### 1.1 Bootstrap the app route groups

**Prompt:**
> Create the app section of the repo, without touching any existing landing page files.
>
> 1. Create the folder structure per `app-dashboard/CLAUDE.md § 8`:
>    - `/app/(app)/layout.tsx` (app shell placeholder — will get sidebar/header in 1.7)
>    - `/app/(app)/page.tsx` — the app root redirect (see below)
>    - `/app/(app)/dashboard/page.tsx` as placeholder returning `<div>Dashboard placeholder</div>`
>    - `/app/(auth)/layout.tsx` — minimal centered-card layout for login/signup
>    - `/app/(auth)/login/page.tsx`, `/app/(auth)/signup/page.tsx`, `/app/(auth)/accept-invite/page.tsx` as placeholders
>    - Empty `/components/app/`, `/lib/supabase/` (may already exist from landing page — check first, don't overwrite the landing page's Supabase client)
>    - Empty `/lib/auth/`, `/lib/db/`, `/lib/validation/app/`, `/lib/format/`
>    - `/supabase/migrations/` — check if exists; if the landing page uses this dir, we'll need to be careful in 1.3 not to clash
>
> 2. Build `app/(app)/page.tsx` — the app root redirect:
>    ```tsx
>    // For now, always redirect to /login. Post-Phase-1.6 we'll add real auth check.
>    import { redirect } from 'next/navigation';
>    export default function AppRoot() {
>      redirect('/login');
>    }
>    ```
>
> 3. **IMPORTANT — no host-based middleware rewrite.** CLAUDE.md § 12 uses Option B (two Vercel projects). Route groups handle URL mapping natively. Do NOT add host-based logic to `middleware.ts`.
>
>    If a `middleware.ts` doesn't exist yet at repo root, create one that does ONLY Supabase auth session refresh — no rewrites, no host checks. The auth refresh logic will be added properly in Task 1.2.
>
>    If a `middleware.ts` already exists for the landing page (Loops/waitlist related), extend it to also refresh Supabase auth cookies for `/dashboard/*`, `/inventory/*`, `/sales/*`, etc. — but still no host-based routing.
>
> 4. Update `.env.example` with the app-specific vars from CLAUDE.md § 10. Add a comment header noting these are separate from the landing page vars.
>
> 5. Do NOT modify any file under `app/(marketing)/*` or `components/marketing/*`. Do NOT touch the root `CLAUDE.md` or `BUILD.md`.
>
> **Acceptance:**
> - `pnpm dev` still serves the landing page at `/` unchanged
> - Visiting `localhost:3000/login` shows the placeholder login page
> - Visiting `localhost:3000/dashboard` shows the placeholder dashboard
> - No changes to marketing routes visible

### 1.2 Supabase project setup

**Prompt:**
> Set up the app's Supabase project (separate from the waitlist DB).
>
> 1. In the user's Supabase dashboard, create a NEW project called `floventro-app`. Region: closest to Nigeria (probably `eu-west-1` — Ireland, or `af-south-1` if Cape Town is available). Wait for it to provision.
> 2. From the new project's Settings → API, copy:
>    - Project URL → `NEXT_PUBLIC_APP_SUPABASE_URL`
>    - `anon` public key → `NEXT_PUBLIC_APP_SUPABASE_ANON_KEY`
>    - `service_role` secret → `APP_SUPABASE_SERVICE_ROLE_KEY`
> 3. Add all three to `.env.local` locally.
> 4. In `lib/supabase/`:
>    - Create `app-server.ts` — export `createAppServerClient()` using `@supabase/ssr`, reading `APP_SUPABASE_*` env vars, handling cookies for auth. **Named differently from the landing page's server client** so the two clients coexist.
>    - Create `app-client.ts` — export `createAppBrowserClient()` for client components.
>    - Update `middleware.ts` at repo root to call the app's `updateSession()` helper for authenticated app routes.
> 5. Wire up the app-side session refresh in the root `middleware.ts` — matcher config should target `/dashboard/*`, `/inventory/*`, `/sales/*`, `/internal-use/*`, `/admin/*`, `/onboarding/*`, and `/accept-invite/*`. Leave marketing routes untouched.
>
> **Note:** No Vercel deployment work in this task. The second Vercel project doesn't need to exist yet — that comes in Phase 1.5 or 1.6 when we want to test signup at a real URL. Local dev on `localhost:3000` is fine for tasks 1.1 through ~1.5.
>
> Do NOT run any migrations yet — schema comes next.
>
> **Acceptance:** User confirms they've created the Supabase project and copied the keys. Env vars are set. `pnpm dev` still runs.

### 1.3 Core schema: organisations, branches, memberships

**Prompt:**
> Write the foundational schema. This is the most important migration of Phase 1 — it defines multi-tenancy.
>
> Create `supabase/migrations/0001_core.sql`:
>
> ```sql
> -- Enable required extensions
> create extension if not exists "pgcrypto";
>
> -- Organisations (tenants)
> create table public.organisations (
>   id uuid primary key default gen_random_uuid(),
>   name text not null,
>   country_code text not null default 'NG',
>   currency text not null default 'NGN',
>   timezone text not null default 'Africa/Lagos',
>   created_at timestamptz not null default now(),
>   updated_at timestamptz not null default now(),
>   deleted_at timestamptz
> );
>
> -- Branches (aka stores)
> create table public.branches (
>   id uuid primary key default gen_random_uuid(),
>   organisation_id uuid not null references public.organisations(id) on delete restrict,
>   name text not null,
>   created_at timestamptz not null default now(),
>   updated_at timestamptz not null default now(),
>   deleted_at timestamptz,
>   unique (organisation_id, name)
> );
>
> -- Roles enum (text with check for flexibility)
> create table public.memberships (
>   id uuid primary key default gen_random_uuid(),
>   user_id uuid not null references auth.users(id) on delete cascade,
>   organisation_id uuid not null references public.organisations(id) on delete cascade,
>   branch_id uuid references public.branches(id) on delete cascade,   -- null for owner memberships that span all branches
>   role text not null check (role in ('owner', 'inventory', 'sales', 'internal_use')),
>   created_at timestamptz not null default now(),
>   deleted_at timestamptz,
>   unique (user_id, organisation_id, branch_id, role)
> );
>
> -- updated_at triggers
> create or replace function public.set_updated_at() returns trigger as $$
> begin
>   new.updated_at = now();
>   return new;
> end;
> $$ language plpgsql;
>
> create trigger organisations_updated_at before update on public.organisations
>   for each row execute function public.set_updated_at();
> create trigger branches_updated_at before update on public.branches
>   for each row execute function public.set_updated_at();
>
> -- Indexes
> create index memberships_user_id_idx on public.memberships(user_id) where deleted_at is null;
> create index memberships_organisation_id_idx on public.memberships(organisation_id) where deleted_at is null;
> create index branches_organisation_id_idx on public.branches(organisation_id) where deleted_at is null;
> ```
>
> Then apply RLS in `supabase/migrations/0002_core_rls.sql`:
>
> ```sql
> -- Enable RLS
> alter table public.organisations enable row level security;
> alter table public.branches enable row level security;
> alter table public.memberships enable row level security;
>
> -- Organisations: readable if you have a membership in it
> create policy "read own org" on public.organisations
> for select using (
>   exists (
>     select 1 from public.memberships m
>     where m.user_id = auth.uid()
>       and m.organisation_id = organisations.id
>       and m.deleted_at is null
>   )
> );
>
> -- Organisations: any authenticated user can create one (they'll get an owner membership in same transaction via RPC)
> create policy "insert own org" on public.organisations
> for insert with check (auth.uid() is not null);
>
> -- Organisations: only owners can update their org
> create policy "update own org" on public.organisations
> for update using (
>   exists (
>     select 1 from public.memberships m
>     where m.user_id = auth.uid()
>       and m.organisation_id = organisations.id
>       and m.role = 'owner'
>       and m.deleted_at is null
>   )
> );
>
> -- Branches: readable if you have any membership in the org
> create policy "read branches in own org" on public.branches
> for select using (
>   exists (
>     select 1 from public.memberships m
>     where m.user_id = auth.uid()
>       and m.organisation_id = branches.organisation_id
>       and m.deleted_at is null
>   )
> );
>
> -- Branches: only owners can create/update
> create policy "insert branches as owner" on public.branches
> for insert with check (
>   exists (
>     select 1 from public.memberships m
>     where m.user_id = auth.uid()
>       and m.organisation_id = branches.organisation_id
>       and m.role = 'owner'
>       and m.deleted_at is null
>   )
> );
>
> create policy "update branches as owner" on public.branches
> for update using (
>   exists (
>     select 1 from public.memberships m
>     where m.user_id = auth.uid()
>       and m.organisation_id = branches.organisation_id
>       and m.role = 'owner'
>       and m.deleted_at is null
>   )
> );
>
> -- Memberships: readable if it's your own OR if you're an owner of the org
> create policy "read own memberships" on public.memberships
> for select using (
>   user_id = auth.uid()
>   or exists (
>     select 1 from public.memberships m
>     where m.user_id = auth.uid()
>       and m.organisation_id = memberships.organisation_id
>       and m.role = 'owner'
>       and m.deleted_at is null
>   )
> );
>
> -- Memberships: inserts happen via security-definer RPCs only (see next migration)
> -- No public insert policy.
> ```
>
> Then the org creation RPC in `supabase/migrations/0003_create_org_rpc.sql`:
>
> ```sql
> -- Creates org + first owner membership atomically
> create or replace function public.create_organisation(
>   org_name text,
>   country_code text default 'NG',
>   currency text default 'NGN',
>   timezone text default 'Africa/Lagos'
> ) returns uuid
> language plpgsql
> security definer
> set search_path = public
> as $$
> declare
>   new_org_id uuid;
> begin
>   if auth.uid() is null then
>     raise exception 'not authenticated';
>   end if;
>
>   insert into organisations (name, country_code, currency, timezone)
>   values (org_name, country_code, currency, timezone)
>   returning id into new_org_id;
>
>   insert into memberships (user_id, organisation_id, role)
>   values (auth.uid(), new_org_id, 'owner');
>
>   return new_org_id;
> end;
> $$;
>
> revoke all on function public.create_organisation from public;
> grant execute on function public.create_organisation to authenticated;
> ```
>
> **Do not run the migration yet.** Report to the user with:
> - Files created
> - A summary of what the schema does
> - Ask the user to review the SQL before running it against Supabase
>
> Once approved, apply via Supabase dashboard SQL editor (safer than CLI push at this stage). Then generate types: `pnpm dlx supabase gen types typescript --project-id $APP_SUPABASE_PROJECT_ID > types/supabase.ts`.
>
> **Acceptance:** All three migrations approved and run. `types/supabase.ts` regenerated. User confirms the tables exist in Supabase dashboard.

### 1.4 Auth: signup + login + logout

**Prompt:**
> Build the auth screens. Keep them minimal — full-form design is a Phase 9 concern.
>
> 1. `/app/(auth)/signup/page.tsx` — client form with:
>    - Full name, email, password
>    - Zod-validated (min 8 char password, valid email)
>    - Submits to `signUpAction` server action
>    - On success, redirects to `/onboarding/create-org`
>    - Error state below the form
> 2. `signUpAction` in `lib/auth/actions.ts`:
>    - Calls `supabase.auth.signUp({ email, password, options: { data: { full_name } } })`
>    - On success returns `{ ok: true }`
>    - On duplicate email returns `{ ok: false, error: 'account_exists' }` with UI hint
> 3. `/app/(auth)/login/page.tsx` — email + password → `signInAction` → redirect to `/dashboard` on success
> 4. `/app/(auth)/logout` — POST-only route handler that calls `signOut()` and redirects to `/login`
>
> Style:
> - Centered card, `max-w-sm`, white background on `bg-neutral-50` page
> - Floventro wordmark logo at top (reuse from landing page `/public/asset/logo.svg`)
> - Card: `p-8 rounded-xl border border-neutral-300`
> - Primary button: violet, full-width, `rounded-md`
> - Inputs: shadcn Input with brand tokens
> - Small "Already have an account? Log in" link at bottom
>
> **Acceptance:** Can create an account. Can log in. Can log out. Auth cookies work across page reloads. All tested locally at `localhost:3000`.

### 1.5 Onboarding: create organisation + first branch

**Prompt:**
> Build the onboarding flow that runs immediately after signup.
>
> 1. `/app/(app)/onboarding/create-org/page.tsx`:
>    - Guarded: if user already has memberships, redirect to `/dashboard`
>    - Form: organisation name, country (default Nigeria), currency (default NGN, readonly for V1), timezone (default Africa/Lagos)
>    - Submits to `createOrgAction` which calls the `create_organisation` RPC
>    - On success redirects to `/onboarding/create-branch?org={id}`
> 2. `/app/(app)/onboarding/create-branch/page.tsx`:
>    - Guarded: needs `org` query param and user must be an owner of that org
>    - Form: branch name (e.g. "HQ", "Lagos Branch")
>    - Submits to `createBranchAction` (regular insert; RLS enforces owner-only)
>    - On success redirects to `/dashboard`
>
> Include a small progress indicator at top ("Step 1 of 2" / "Step 2 of 2").
>
> **Acceptance:** New user goes signup → create org → create branch → dashboard. Two different users end up in two different orgs with no cross-visibility.

### 1.6 Scope resolution + membership guards

**Prompt:**
> Build the scoping layer that every app page uses to know "current org, current branch, current role."
>
> 1. `lib/auth/scope.ts`:
>    - Export `getCurrentScope()`: reads the current selection from cookies (`floventro_org`, `floventro_branch`, `floventro_role`). If cookies are missing or invalid, falls back to the user's first membership. Returns `{ userId, organisationId, branchId, role }` or `null` if unauthenticated.
>    - Export `setCurrentScope({ organisationId, branchId, role })`: writes cookies (httpOnly, secure in prod, sameSite lax, 30-day expiry).
>    - Validates the scope against the user's actual memberships before setting.
> 2. `lib/auth/guards.ts`:
>    - `requireAuth()`: returns userId or redirects to `/login`
>    - `requireScope()`: returns full scope or redirects to `/onboarding/create-org` if user has no memberships
>    - `requireRole(...roles)`: returns scope if role matches, otherwise returns a 403 rendering
>    - `requireOwner()`: sugar for `requireRole('owner')`
> 3. Update `app/(app)/page.tsx` (the app root redirect from Task 1.1) to use these guards:
>    - Not authenticated → redirect to `/login`
>    - Authenticated but no membership → redirect to `/onboarding/create-org`
>    - Authenticated with membership → redirect to `/dashboard`
>
> **Acceptance:** A user with two memberships (owner in one org, sales in another) can switch scope and see the right dashboard. The bare `/` visit routes intelligently based on auth state.

### 1.7 App shell: sidebar, header, scope switcher

**Prompt:**
> Build the persistent app shell that wraps every authenticated screen.
>
> 1. `/app/(app)/layout.tsx`:
>    - Server component. Calls `requireScope()`. If it returns null, redirect.
>    - Renders `<Sidebar />` (left, 240px, fixed), `<AppHeader />` (top of content area), and children.
> 2. `components/app/sidebar/sidebar.tsx`:
>    - Logo mark + wordmark at top
>    - Nav items filtered by current role:
>      - Owner: Dashboard, Inventory, Sales, Internal Use, Branches, Team, Settings
>      - Inventory: Dashboard, Vendors, Invoices, Requests, Transfers, Products
>      - Sales: Dashboard, Products, Requests, Customers, Sales
>      - Internal Use: Dashboard, Products, Requests, Clients, Usage
>    - Active state: `bg-neutral-100 text-violet` with a subtle left border
>    - Icons from Lucide (outline)
>    - User avatar/name at bottom with a dropdown: switch scope, logout
> 3. `components/app/header/app-header.tsx`:
>    - Left: page title (passed as a slot)
>    - Right: scope switcher — a shadcn `<Select>` or `<DropdownMenu>` showing "Organisation → Branch → Role" and letting the user switch
>    - Sticky top, `bg-white border-b border-neutral-300 h-14`
> 4. `components/app/switcher/scope-switcher.tsx`:
>    - Client component
>    - Lists all the user's memberships
>    - Selecting a different one calls `setCurrentScope` and refreshes the current route
>
> **Acceptance:** After onboarding, user lands in `/dashboard` inside the shell. Sidebar reflects their role. Switching scope updates the sidebar and page.

### 1.8 Empty dashboard

**Prompt:**
> Build the empty-state dashboard so Phase 1 has a clean checkpoint.
>
> 1. `/app/(app)/dashboard/page.tsx`:
>    - Server component. Calls `requireScope()`.
>    - Renders a page-title header "Welcome, {full_name}" using data from Supabase auth.
>    - Below: a role-specific empty state block:
>      - Owner: "You have 1 branch. Add products to your catalogue to get started." → "Add products" CTA (disabled/links nowhere; that's Phase 2)
>      - Inventory: "No stock recorded yet. Register vendors and record your first invoice."
>      - Sales: "No stock available to sell yet. Ask Inventory to fulfil a request."
>      - Internal Use: "No stock available yet. Ask Inventory to fulfil a request."
>    - Styling: max-w-2xl, centered on the page, muted neutrals, one primary CTA.
>
> **Acceptance:** All four role variants render distinct empty states.

### 1.9 Phase 1 verification (local)

**Prompt:**
> Run the Phase 1 checkpoint tests locally on `localhost:3000`. Report results in a markdown checklist.
>
> 1. **Two-user isolation test:**
>    - Sign up User A → create org "Alpha Corp" → create branch "HQ" → dashboard loads
>    - Log out
>    - Sign up User B → create org "Beta Corp" → create branch "Main" → dashboard loads
>    - Log back in as User A → dashboard still shows Alpha Corp scope
>    - In Supabase dashboard's SQL editor, run: `select * from organisations` as User B's context → should see only Beta Corp
>
> 2. **RLS denial test:**
>    - As User A logged in, open browser devtools console and attempt: `await supabase.from('organisations').select('*')` → should return only Alpha Corp
>    - Attempt: `await supabase.from('branches').select('*').eq('organisation_id', BETA_ORG_ID)` → should return empty (0 rows), not an error
>
> 3. **Role guard test:**
>    - As User A (owner), visit `/dashboard` → renders owner variant
>    - Manually change the `floventro_role` cookie to `sales` in devtools
>    - Reload → should not render sales dashboard because user isn't a sales member (`requireScope` should reject the invalid scope and revert to owner)
>
> 4. **Logout test:** Log out → try to visit `/dashboard` → redirected to `/login`
>
> If any test fails, stop and report. Do not proceed to Phase 2 until all four pass.
>
> **Note:** Phase 1 does NOT include creating the second Vercel project or the `app.floventro.com` subdomain. That happens in Phase 4 or 5 when we want to test invitations at a real URL. Everything up to that point works locally on `localhost:3000`.

---

# PHASE 2 — Product catalogue + vendor registry

**Goal:** Owner and Inventory role can add products to the catalogue and register vendors. No stock movement yet — this is reference data.

**Checkpoint:** Two different orgs each have their own catalogue and vendors, with zero cross-visibility. Deleting a product soft-deletes and it disappears from lists but is preserved for future ledger references.

### 2.1 Products schema + RLS

**Prompt:**
> Migrations `0004_products.sql` and `0005_products_rls.sql`.
>
> Table `products`:
> - id uuid PK
> - organisation_id uuid FK
> - sku text not null (unique per org)
> - name text not null
> - description text
> - unit_cost_cents bigint (last-known cost, optional; historical costs live on invoice_lines)
> - reorder_point integer default 0 (for low-stock warnings later)
> - created_at, updated_at, deleted_at (soft delete)
> - unique (organisation_id, sku) where deleted_at is null
>
> **Note:** Products are org-scoped, NOT branch-scoped. The catalogue is shared across branches. Per-branch stock lives in a separate `product_stock` table added in Phase 3.
>
> RLS:
> - Read: any member of the org
> - Insert/Update/Delete: owner or inventory role (in any branch of the org)
>
> Apply, regenerate types.

### 2.2 Vendors schema + RLS

**Prompt:**
> Migrations `0006_vendors.sql` and `0007_vendors_rls.sql`.
>
> Table `vendors`:
> - id uuid PK
> - organisation_id uuid FK
> - branch_id uuid FK (vendors ARE branch-scoped — each branch has its own vendor list)
> - name text not null
> - contact_person text
> - phone text
> - email text
> - tin text (Nigerian Tax Identification Number)
> - cac_registration text (Corporate Affairs Commission registration)
> - notes text
> - created_at, updated_at, deleted_at
> - unique (branch_id, name) where deleted_at is null
>
> RLS:
> - Read: any member of the branch (owner sees all branches)
> - Insert/Update/Delete: owner or inventory role in that branch
>
> Apply, regenerate types.

### 2.3 Product catalogue screens (Inventory, Owner)

**Prompt:**
> Build the product management screens.
>
> 1. `/app/(app)/inventory/products/page.tsx` (Inventory role, and Owner) — list view:
>    - Data table (shadcn `<Table>`): SKU, Name, Reorder point, Actions (Edit, Delete)
>    - Search by SKU or name (client-side for now; server-side pagination in a later pass)
>    - "New product" button top-right → opens a modal
>    - Empty state: "No products yet. Add your first product to build your catalogue."
> 2. New/Edit product modal (`components/app/forms/product-form.tsx`):
>    - Fields: SKU, name, description (textarea), reorder point (number)
>    - Zod-validated
>    - Submits to `createProductAction` or `updateProductAction`
>    - Success: toast + closes modal + refreshes list
> 3. Delete: confirmation dialog → `deleteProductAction` (soft delete, sets `deleted_at`)
>
> **Acceptance:** Can create, edit, soft-delete products. Two orgs see completely different catalogues.

### 2.4 Vendor management screens (Inventory, Owner)

**Prompt:**
> Build vendor management. Same pattern as products but with vendor-specific fields.
>
> 1. `/app/(app)/inventory/vendors/page.tsx` — list view:
>    - Table: Name, Contact person, Phone, TIN, Actions
>    - Search by name or contact
>    - "New vendor" button → modal
>    - Owner-only: a branch filter dropdown at the top (defaults to current branch)
> 2. Vendor form: name, contact_person, phone, email, tin, cac_registration, notes
> 3. Delete: soft-delete with confirmation
>
> **Acceptance:** Vendors are branch-scoped. Owner can see all branches' vendors via the filter. Inventory role sees only their branch.

### 2.5 Phase 2 verification

**Prompt:**
> Run the Phase 2 checkpoint tests. Report results.
>
> 1. **Catalogue isolation:** Two orgs each add 5 products. Each sees only their own. RLS-level query as one org for the other's products returns empty.
> 2. **Vendor branch scoping:** Inventory user in Branch A cannot see Branch B's vendors. Owner sees both.
> 3. **Soft delete integrity:** Delete a product → disappears from list. Query DB directly → row still exists with `deleted_at` set.
> 4. **Unique constraints:** Try to create two products with the same SKU in the same org → second one is rejected with a friendly error.
>
> All four must pass before Phase 3.

---

# PHASES 3-9 (sketched only)

These are intentionally not detailed yet. Writing detailed prompts now would be pretend precision — the schema and UI patterns will crystallise as Phases 1 and 2 land.

### Phase 3 — Vendor invoices → stock arrives

- `product_stock` table (per branch, per product), `stock_ledger` table (append-only)
- Migration `0008_stock_ledger.sql`
- RPC `record_vendor_invoice(vendor_id, lines[], due_date)` — atomic write of invoice + lines + ledger entries + product_stock updates
- Screens: "New invoice" form (Inventory role), invoices list, vendor detail page with balance
- Dashboard cards: outstanding vendor balance, items received this month

### Phase 4 — Team invites

- `invitations` table with token + expiry
- RPC `accept_invitation(token)` — security-definer, creates membership atomically
- Loops transactional email for invites (uses `LOOPS_INVITE_TRANSACTIONAL_ID`)
- Screens: `/admin/team` (owner only), invite modal, `/accept-invite/:token`
- Post-acceptance: role-appropriate empty dashboard
- **This is likely when we create the second Vercel project and `app.floventro.com` subdomain** — invited users need a real URL to click.

### Phase 5 — Internal requests

- `requests` table + `request_lines` (requested + approved qty per line)
- Status: pending / approved / partial / rejected / fulfilled
- RPC `approve_request(request_id, lines[{line_id, approved_qty}])` — atomic ledger transfer from Inventory holding to requester holding
- Screens: request list (both sides), request detail with approve UI (Inventory), request creation (Sales / Internal Use)

### Phase 6 — Sales and service usage

- `customers` + `sales` + `sale_lines` (Sales role)
- `clients` + `usages` + `usage_lines` (Internal Use role)
- RPCs `record_sale` and `record_usage` — atomic ledger consumption + upsert customer/client
- Screens: sale/usage recording forms, customer/client detail pages with history

### Phase 7 — Inter-branch transfers

- `transfers` table + `transfer_lines`
- Sending side initiates → creates pending transfer + decrements sender ledger
- Receiving side confirms → identical to vendor invoice receiving UI, but with `source_branch_id` set
- RPC `send_transfer` and `receive_transfer` (atomic)

### Phase 8 — Owner cross-branch dashboard

- Materialised views for expensive rollups (total stock across all branches, outstanding vendor balance sum, etc.)
- Refresh triggers on ledger changes
- Dashboard cards, drill-down navigation
- Add Sentry error tracking
- Add Vercel Analytics events for key actions

### Phase 9 — Polish

- Empty states everywhere
- Error boundaries on every route
- Mobile responsive sidebar (drawer)
- Accessibility pass (keyboard nav, ARIA, focus rings)
- Edge cases: what if inventory tries to fulfil more than available? What if two invoices arrive with the same reference?
- Copy pass with the owner
- Loading skeletons everywhere

---

## When we get to each new phase

I'll write the detailed prompts for that phase then, informed by what we
learned in previous phases. Do not ask for Phase 3 prompts before Phase 2's
checkpoint passes.

---

## Deployment work (deferred to Phase 4+)

The second Vercel project (`floventro-app`) and the `app.floventro.com`
subdomain are NOT set up during Phase 1. They're deferred until we actually
need them, which is either:
- **Phase 4**, when invitations require a real clickable URL for invitees, OR
- Whenever the owner wants to share the app with a co-founder or test user

At that point, follow the deployment section in `app-dashboard/CLAUDE.md § 12`:
1. Create the second Vercel project (import same GitHub repo)
2. Configure the ignored build step script
3. Add `app.floventro.com` as a domain on the app project
4. Add the CNAME record in Hostinger (value provided by Vercel)
5. Migrate env vars into the new project
6. Update `NEXT_PUBLIC_APP_URL` to `https://app.floventro.com`