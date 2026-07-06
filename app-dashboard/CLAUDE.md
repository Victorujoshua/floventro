# Floventro App — Project Context

> This file is read by Claude Code on every app task. Keep it short, accurate, current.
> This file is scoped to `app/(app)/*`, `app/(auth)/*`, `components/app/*`, `lib/auth/*`, `lib/db/*`, `lib/supabase/*`, and `supabase/migrations/*`.
> The landing page has its own CLAUDE.md at the repo root — do not touch it.

---

## 1. What we're building

Floventro is a multi-tenant inventory and distribution SaaS for businesses
operating across one or many branches. This directory contains the product
itself — auth, org/branch tenancy, product catalogue, vendor management,
stock ledger, internal requests, sales, service usage, and cross-branch
transfers.

The landing page (marketing site + waitlist) is a separate concern at repo root.

---

## 2. Non-negotiable product principles

Read these before every session. They govern every decision.

1. **Multi-tenant safety first.** Every query is scoped by organisation and, where applicable, by branch. RLS policies enforce this at the database layer. If the code accidentally leaks another org's data, RLS should stop it. If both fail, this is a critical bug.

2. **Stock is money.** Every stock movement must be atomic and auditable. No partial writes. No optimistic UI that could show a state that isn't real. If the DB says stock = 40, the UI shows 40. Period.

3. **Roles constrain, they never permit.** A Sales team member sees only what Sales roles are allowed to see. Owners can see everything, but Owners still act *as* a role when they perform an action (recording a sale creates a sales record, not an "owner override" record).

4. **No silent failures.** Every server action returns a discriminated result. Every UI treats failure as a real state, not a spinner that lasts forever.

5. **The four roles are structurally different, not skins.** Sales and Internal Use may look similar in the spec but their data models diverge (customers vs clients, sales_lines vs usage_lines). Don't unify them prematurely.

---

## 3. Brand system (product UI)

The Floventro brand mark carries from the landing page. The rest of the visual
language is different — this is a product UI, not editorial content.

### Colors

| Token         | Hex       | Tailwind class     | Usage                                       |
|---------------|-----------|--------------------|---------------------------------------------|
| Violet        | `#4A02C8` | `bg-violet`, `text-violet` | Primary CTAs, active states, brand accents |
| Coral         | `#F95F3D` | `bg-coral`, `text-coral` | Destructive actions, warnings, alerts (sparingly) |
| Neutral 950   | `#0A0A0A` | `text-neutral-950` | Primary text                                |
| Neutral 700   | `#404040` | `text-neutral-700` | Secondary text                              |
| Neutral 500   | `#737373` | `text-neutral-500` | Muted / meta                                |
| Neutral 300   | `#D4D4D4` | `border-neutral-300` | Borders, dividers                         |
| Neutral 100   | `#F5F5F5` | `bg-neutral-100`   | Subtle surfaces, hover states               |
| Neutral 50    | `#FAFAFA` | `bg-neutral-50`    | Page background                             |
| White         | `#FFFFFF` | `bg-white`         | Cards, tables, modals                       |
| Success       | `#10B981` | `text-success`     | Stock available, approved, positive states  |
| Warning       | `#F59E0B` | `text-warning`     | Low stock, near due, attention              |
| Danger        | `#EF4444` | `text-danger`      | Out of stock, overdue, errors               |

**Rules:**
- Violet is for user-initiated primary actions ("Save invoice", "Approve request"). Use once per screen area.
- Coral is for destructive confirmations ("Delete vendor", "Reject request"). Not for CTAs.
- Never use Cream (`#F5F1EA`) here — that's the marketing site's language, not the product's.

### Typography

**Inter for everything.** No serif in the product UI.

| Use                | Class                              |
|--------------------|------------------------------------|
| Page title (h1)    | `text-3xl font-semibold tracking-tight` |
| Section title (h2) | `text-xl font-semibold` |
| Card title (h3)    | `text-base font-semibold` |
| Body               | `text-sm text-neutral-700` |
| Meta / labels      | `text-xs font-medium text-neutral-500 uppercase tracking-wide` |
| Numeric data       | `text-sm font-mono tabular-nums` |
| Currency (₦)       | The `₦` symbol is wrapped in a span with `font-inter` — even inside tabular data — so it doesn't fall back to a serif when Inter doesn't include the glyph. Convention: `<span className="font-inter">₦</span>1,240,000`. |

### Layout

- Sidebar-first layout. Left sidebar (240px), main content area, no top nav clutter.
- Content max-width: `max-w-6xl` for most pages; full width for tables and lists.
- Standard page padding: `px-8 py-6`.
- Card padding: `p-6`.
- Table rows: `py-3` for comfort, `py-2` for dense views.

### Components

**shadcn/ui is the base for everything.** Buttons, inputs, tables, dialogs,
selects, tabs, dropdowns, tooltips — install as needed. Restyle to brand
tokens; do not accept zinc/slate defaults.

Rounded corners:
- Buttons, inputs: `rounded-md`
- Cards, panels: `rounded-lg`
- Modals: `rounded-xl`
- Full-round only for pill status badges

Icons: **Lucide outline only.** Never emoji, never filled icons except when
denoting a state (filled star = favourite, etc.).

---

## 4. Tech stack

| Layer            | Choice                                       | Notes |
|------------------|----------------------------------------------|-------|
| Framework        | Next.js 16 (App Router, TypeScript strict)   | Same as landing page |
| Styling          | Tailwind CSS v4                              | |
| Components       | shadcn/ui (v4-compatible)                    | |
| Auth             | Supabase Auth (email + password)             | |
| Database         | Supabase Postgres                            | **Separate project** from landing page's waitlist DB |
| ORM / queries    | Supabase client + generated TypeScript types | No Prisma. |
| Forms            | React Hook Form + Zod                        | |
| Server logic     | Server Actions + route handlers              | Actions for mutations, handlers for API integrations |
| State (client)   | React Query for server state; useState local | No global client store yet |
| Currency         | Fixed to NGN (`₦`) at V1; org.currency column present but ignored until V2 |
| Money format     | Store as `bigint` cents (e.g. ₦1,000 = 100000). Never floats. |
| Dates            | Store `timestamptz` in UTC; render in org.timezone |
| Hosting          | Vercel — **separate project** from marketing (see § 12) |
| Email            | Loops for org invites + transactional        | Same account, new transactional templates |
| Analytics        | Vercel Analytics                             | |
| Error tracking   | Sentry (add in Phase 8)                      | Deferred |

---

## 5. Multi-tenancy model

This is the foundation. Every table, every query, every policy reflects it.

### Ownership hierarchy

```
organisation
  └── branch (aka store; internal name: branch)
       └── product_stock (per-branch stock per product)
       └── vendor (per-branch)
       └── customer (per-branch, for Sales)
       └── client (per-branch, for Internal Use)
       └── all transactional records (invoices, sales, requests, transfers, usage)
membership
  ↳ links a user to an (organisation, branch, role) triple
```

**A user can have multiple memberships** — e.g. Sales role in HQ, Inventory role in Lagos Branch. Auth is at the user level; scope is at the membership level.

### Enforcement layers

Every table has RLS. Every policy checks membership. Three layers, in order:

1. **Database RLS** — the source of truth. If a policy denies, the query returns empty. Never trust code alone.
2. **Server actions / handlers** — validate the *intent* (this user chose to act as Sales in Lagos Branch) and set the `organisation_id` + `branch_id` on writes. RLS then verifies the user actually has that membership.
3. **UI** — hides what the user can't act on. Never security; just UX.

**Selecting a "current org + branch + role"** happens at login and can be switched via a header dropdown. This selection is stored in a cookie and passed into every server action.

### RLS policy template

Every table follows this pattern (adjusted for role):

```sql
-- Everyone can read rows in their org/branch
create policy "read own scope" on table_name
for select using (
  exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.organisation_id = table_name.organisation_id
      and m.branch_id = table_name.branch_id
      and m.role in ('owner', /* other allowed roles */)
  )
);

-- Writers restricted by role
create policy "insert as role" on table_name
for insert with check (
  exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.organisation_id = table_name.organisation_id
      and m.branch_id = table_name.branch_id
      and m.role in ('owner', /* writer roles */)
  )
);
```

Owners always pass. Non-owners pass only if their role matches the operation.

---

## 6. Data conventions

- **Primary keys:** `uuid` via `gen_random_uuid()`.
- **Timestamps:** `created_at timestamptz not null default now()`; `updated_at timestamptz` maintained by trigger.
- **Soft delete:** `deleted_at timestamptz null`. Everything filters `deleted_at is null` by default.
- **Money:** stored as `bigint` (cents). E.g. NGN 1,000.00 = `100000`. Never floats. UI formats to `₦1,000.00`.
- **Quantities:** `integer` (whole units) for V1. When we add fractional units (kg, L), migrate to `numeric(12, 3)`.
- **Enums:** as text with a check constraint (easier to alter than Postgres enums).
- **Stock ledger is append-only.** Never `UPDATE` or `DELETE` a ledger row. Corrections happen via a reversing entry.

---

## 7. Transactional integrity

Any operation that changes stock must be a single database transaction, wrapped in a Supabase RPC (Postgres function). Server actions call the RPC; they don't chain individual `insert`/`update` calls.

Examples:
- Recording a vendor invoice → insert invoice + insert invoice_lines + insert stock_ledger rows (one per line) + update vendor balance → all in one RPC.
- Approving an internal request → update request status + insert stock_ledger transfer entries + update requester's holding → one RPC.
- Recording a sale → insert sale + insert sale_lines + insert stock_ledger consumption entries + upsert customer → one RPC.

If any step fails, everything rolls back. No half-recorded sales, ever.

---

## 8. Project structure

```
your-repo/
├── CLAUDE.md                # landing page context (do not touch)
├── BUILD.md                 # landing page build plan (do not touch)
├── app-dashboard/
│   ├── CLAUDE.md            # this file
│   └── BUILD.md             # app build plan
├── app/                     # Next.js App Router — routes for BOTH projects live here
│   ├── (marketing)/         # served by Marketing project on floventro.com
│   │   ├── page.tsx
│   │   └── layout.tsx
│   ├── (app)/               # served by App project on app.floventro.com — NEW
│   │   ├── layout.tsx       # app shell (sidebar, header)
│   │   ├── page.tsx         # redirect logic for app.floventro.com root
│   │   ├── dashboard/page.tsx
│   │   ├── inventory/*
│   │   ├── sales/*
│   │   ├── internal-use/*
│   │   └── admin/*
│   ├── (auth)/              # served by App project — NEW
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   ├── accept-invite/page.tsx
│   │   └── layout.tsx
│   ├── api/*                # both projects serve their own API routes
│   ├── layout.tsx           # shared root layout
│   └── globals.css          # shared
├── components/
│   ├── marketing/           # landing page components (do not touch)
│   ├── app/                 # app-only components — NEW
│   │   ├── sidebar/
│   │   ├── switcher/
│   │   ├── tables/
│   │   ├── forms/
│   │   └── dashboard-cards/
│   └── ui/                  # shadcn primitives (shared)
├── lib/
│   ├── supabase/
│   │   ├── server.ts        # split into landing-vs-app clients — see § 12
│   │   ├── client.ts
│   │   └── middleware.ts
│   ├── db/
│   │   ├── queries/         # typed query helpers, one file per domain
│   │   └── rpcs/            # typed wrappers for Postgres functions
│   ├── auth/
│   │   ├── scope.ts         # get current membership from cookie
│   │   └── guards.ts        # requireRole(...), requireOwner(), etc.
│   ├── validation/
│   └── format/              # money, dates, quantities
├── types/
│   └── supabase.ts          # generated database types
├── supabase/
│   ├── migrations/*.sql
│   └── seed.sql
└── vercel.json              # per-project ignore rules — see § 12
```

---

## 9. Conventions

- **TypeScript strict.** No `any`. If a Supabase query result is untyped, generate types before writing the query.
- **Server components by default.** `"use client"` only for interactivity.
- **Server actions for all mutations.** Never do writes from client components directly.
- **Every server action returns:** `{ ok: true, data: T } | { ok: false, error: string, code?: string }`. Discriminated. No throws across the wire.
- **Every form uses:** Zod schema → React Hook Form → server action. Client validation + server validation are both required.
- **Every list view has:** loading skeleton, empty state, error state. Never a bare spinner.
- **Table pagination:** cursor-based (Supabase's `range`), not offset. 50 rows per page default.

---

## 10. Environment variables

```env
# Supabase (APP project — NOT the landing page project)
NEXT_PUBLIC_APP_SUPABASE_URL=
NEXT_PUBLIC_APP_SUPABASE_ANON_KEY=
APP_SUPABASE_SERVICE_ROLE_KEY=

# Site
NEXT_PUBLIC_APP_URL=https://app.floventro.com

# Loops (shared account, different transactional templates)
LOOPS_API_KEY=                          # same as landing page
LOOPS_INVITE_TRANSACTIONAL_ID=          # NEW — for team invites
LOOPS_PASSWORD_RESET_TRANSACTIONAL_ID=  # NEW — for password reset

# Feature flags
NEXT_PUBLIC_APP_ENV=development         # development | preview | production
```

**Prefix everything app-related with `APP_` or `NEXT_PUBLIC_APP_`** so it can't be confused with the landing page vars.

Each Vercel project has ONLY the env vars it needs:
- Marketing project → landing page vars only (existing waitlist Supabase, existing Loops template)
- App project → app vars only (new Supabase, new Loops templates) plus `LOOPS_API_KEY` if the same account is used

---

## 11. Commands

```bash
# Development
pnpm dev                             # both landing + app run on :3000 locally
pnpm build
pnpm lint
pnpm typecheck

# shadcn (install as needed)
pnpm dlx shadcn@latest add table select tabs dropdown-menu

# Supabase (APP project only — landing page has its own project)
pnpm dlx supabase gen types typescript --project-id $APP_SUPABASE_PROJECT_ID > types/supabase.ts

# Local Supabase (recommended for schema iteration)
pnpm dlx supabase start              # spins local Postgres for testing
pnpm dlx supabase db reset           # replay all migrations locally
```

---

## 12. Deployment — Two Vercel projects, one GitHub repo

**Chosen architecture: Option B.** Two separate Vercel projects share the same GitHub repo. Each has its own domain, its own env vars, and skips builds when the commit doesn't affect its files.

### Locally

Both marketing and app routes serve from the same Next.js dev server on
`localhost:3000`. Route groups (`(marketing)`, `(app)`, `(auth)`) determine
what serves at what path:
- `localhost:3000/` → marketing homepage
- `localhost:3000/login` → app login
- `localhost:3000/dashboard` → app dashboard

There is NO host-based rewrite. Routes serve based purely on Next.js file
structure. Do NOT put host-based rewrite logic in `middleware.ts`.

The `middleware.ts` at repo root only handles Supabase auth session refresh
for authenticated app routes. It does not rewrite by host.

### In production

**Marketing project (existing)**
- Vercel project name: `floventro` (existing)
- Domains: `floventro.com`, `www.floventro.com`
- Serves: only `app/(marketing)/*` routes
- Ignored build step: skip when a commit only changes files under `app/(app)/`, `app/(auth)/`, `components/app/`, `lib/auth/`, `lib/db/`, `app-dashboard/`, or `supabase/migrations/`
- Env vars: existing waitlist Supabase + existing Loops template

**App project (new — create in Phase 1.2 or later)**
- Vercel project name: `floventro-app`
- Domains: `app.floventro.com`
- Serves: only `app/(app)/*` and `app/(auth)/*` routes
- Ignored build step: skip when a commit only changes files under `app/(marketing)/`, `components/marketing/`, `docs/`, or the root `CLAUDE.md` / `BUILD.md`
- Env vars: new app Supabase + new Loops templates

### The ignore rule

Each project uses Vercel's "Ignored Build Step" setting. Configure in Vercel
project settings → Git → Ignored Build Step.

For the marketing project, ignored build step command:
```bash
git diff HEAD^ HEAD --quiet -- app/\(marketing\) components/marketing docs public/asset && echo "skip" && exit 0 || exit 1
```
Translation: "If only files OUTSIDE the marketing paths changed, skip. If marketing files changed, build."

Actually — that logic is inverted. Use this instead, saved as `scripts/vercel-ignore-marketing.sh`:
```bash
#!/bin/bash
# Skip build if NO marketing-affecting file changed
if git diff HEAD^ HEAD --quiet -- \
  "app/(marketing)" \
  "components/marketing" \
  "app/layout.tsx" \
  "app/globals.css" \
  "public/asset" \
  "package.json" \
  "next.config.js"; then
  echo "No marketing changes — skipping build."
  exit 0
else
  echo "Marketing changes detected — building."
  exit 1
fi
```

For the app project, saved as `scripts/vercel-ignore-app.sh`:
```bash
#!/bin/bash
# Skip build if NO app-affecting file changed
if git diff HEAD^ HEAD --quiet -- \
  "app/(app)" \
  "app/(auth)" \
  "components/app" \
  "components/ui" \
  "lib" \
  "supabase" \
  "app/layout.tsx" \
  "app/globals.css" \
  "types" \
  "package.json" \
  "next.config.js"; then
  echo "No app changes — skipping build."
  exit 0
else
  echo "App changes detected — building."
  exit 1
fi
```

Point each project's ignored build step to its script.

### DNS for the app subdomain

When `app.floventro.com` is created (Phase 1.2 or later), Vercel will
generate a specific CNAME target for it. In Hostinger DNS, add:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | `app` | (whatever Vercel gives you — usually `cname.vercel-dns.com` or a project-specific one) | 14400 |

Wait until Vercel's dashboard shows the exact target before adding the DNS
record. Do not guess.

### `app/(app)/page.tsx` — the app root redirect

When a user hits `app.floventro.com/` (bare root), redirect based on auth
state:
- Not authenticated → redirect to `/login`
- Authenticated but no membership → redirect to `/onboarding/create-org`
- Authenticated with membership → redirect to `/dashboard`

Task 1.1 creates this file with the redirect logic.

---

## 13. Known gotchas

- **RLS in Supabase Auth callbacks.** When accepting an invite, the user doesn't have a membership yet — you can't use standard RLS. Use a `security definer` RPC to handle the insert.
- **`cookies()` is async** in Next.js 15+. Always `await`.
- **Supabase types drift.** After every migration, regenerate types before writing code that touches the changed tables.
- **Money math.** Never do `price * 100` in JavaScript — floating-point will bite you (0.1 + 0.2 !== 0.3). Do all arithmetic in cents as bigint or in Postgres.
- **Timezone display.** Store UTC, render in `org.timezone`. Default `Africa/Lagos`. Never use user's browser timezone for business dates.
- **Two Vercel projects, one repo.** Both projects rebuild on every push unless the ignored build step is set correctly. A misconfigured ignore rule silently costs money and time. Verify after setup by making a marketing-only commit and confirming ONLY the marketing project deploys.
- **Shared root files trigger both builds.** Any change to `app/layout.tsx`, `app/globals.css`, `package.json`, `next.config.js` will (and should) rebuild both projects. Don't try to be clever about excluding them.

---

## 14. Working style with the project owner

- The owner (Olawale) makes all product decisions.
- When in doubt on data model, wait — don't guess.
- When in doubt on copy, use `// TODO(copy)`.
- Prefer small, reviewable commits. Prefer branch-and-PR over pushing to `main` for anything touching migrations or RLS.
- Every phase ends with a review checkpoint. Do not auto-advance.