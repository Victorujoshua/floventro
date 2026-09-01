# Org Settings Architecture Report

> Read-only investigation. No code was changed.

---

## 1. Organization View Route

**Route group:** `app/(org)/`  
**Layout file:** `app/(org)/layout.tsx`  
**Sidebar component:** `components/org/org-sidebar.tsx` (`OrgSidebar`)

**Page routes:**

| URL | File | Page title |
|-----|------|------------|
| `/org` | `app/(org)/org/page.tsx` | "{OrgName}" / "Overview across N branches" |
| `/org/sales` | `app/(org)/org/sales/page.tsx` | "Sales & Revenue" |
| `/org/ledger` | `app/(org)/org/ledger/page.tsx` | "Org Ledger" |

**OrgSidebar nav items** (`ORG_NAV` constant in `components/org/org-sidebar.tsx:19-23`):

```ts
const ORG_NAV = [
  { label: "Overview",        href: "/org",        icon: LayoutDashboard },
  { label: "Sales & Revenue", href: "/org/sales",  icon: ShoppingCart },
  { label: "Org Ledger",      href: "/org/ledger", icon: BookOpen },
]
```

Below nav: a **Branches** section listing every branch with an "Enter" button.
- Enter calls `enterBranchAction(branchId)` → sets branch cookie → `window.location.href = "/dashboard"`
- "Add branch" link at the bottom → `/admin/branches`

**Layout structure:** Fixed left sidebar `w-60`; content `ml-60 px-8 py-8`.  
**Guard:** `requireOwner()` in both layout and every page. Non-owners cannot access any `/org/*` route.

---

## 2. /admin/settings — What it renders + table targets

**Route:** `app/(app)/admin/settings/page.tsx`  
**Guard:** `requireOwner()` — owner only  
**Client:** `components/app` is not used; client is `app/(app)/admin/settings/settings-client.tsx`

### Setting → Action → Table mapping

| Section (UI label) | Server action | Target table | Column(s) written |
|--------------------|---------------|--------------|-------------------|
| Payout account — organisation default | `updateOrgPayoutAccountAction` | `organisations` | `payout_account_name`, `payout_account_number`, `payout_bank_name` |
| Branch overrides (per-branch dialog) | `updateBranchPayoutAccountAction` | `branches` | `payout_account_name`, `payout_account_number`, `payout_bank_name` |
| Inventory costing (radio: weighted / fifo) | `updateCostingMethodAction` | `organisations` | `costing_method`, `costing_method_set_at` |

All three actions are in `lib/db/actions/settings.ts`. All require `requireOwner()` inside the action (double-guard: page-level + action-level).

---

## 3. Column Confirmation

### `organisations` table

| Column | Migration | Status |
|--------|-----------|--------|
| `payout_account_name` | `app_0030_payout_accounts.sql` line 11 | ✅ exists |
| `payout_account_number` | `app_0030_payout_accounts.sql` line 12 | ✅ exists |
| `payout_bank_name` | `app_0030_payout_accounts.sql` line 13 | ✅ exists |
| `costing_method` | ⚠ **NOT FOUND in any migration** | Gap — see note |
| `costing_method_set_at` | ⚠ **NOT FOUND in any migration** | Gap — see note |

### `branches` table

| Column | Migration | Status |
|--------|-----------|--------|
| `payout_account_name` | `app_0030_payout_accounts.sql` line 16 | ✅ exists |
| `payout_account_number` | `app_0030_payout_accounts.sql` line 17 | ✅ exists |
| `payout_bank_name` | `app_0030_payout_accounts.sql` line 18 | ✅ exists |

### ⚠ Migration gap: costing_method columns

The app_0033 comment says:
```
-- Depends on: app_0032_vat_wht (costing_method column on organisations)
```

But `app_0032_vat_wht.sql` does **not** add `costing_method` or `costing_method_set_at`.
No `ALTER TABLE public.organisations ADD COLUMN costing_method` exists anywhere in the migrations directory.

The columns are referenced in:
- `app_0035_costing_outflows.sql` — `select coalesce(costing_method, 'weighted') from public.organisations`
- `app_0040_fifo_outflows.sql` — same
- `lib/db/actions/settings.ts` — `update({costing_method, costing_method_set_at})`
- `lib/db/queries/settings.ts` — `select("costing_method")`

**Conclusion:** These columns were added directly in the live Supabase DB (not tracked in a migration file). The migration file is missing. The live DB has the columns (the RPCs use `coalesce(costing_method, 'weighted')` which would error without them). If you ever need to recreate the DB from migrations, this migration needs to be written.

**Missing migration would be:**
```sql
alter table public.organisations
  add column costing_method     text not null default 'weighted'
    check (costing_method in ('weighted', 'fifo')),
  add column costing_method_set_at timestamptz;
```

---

## 4. getCostingMethod() and getEffectivePayoutAccount()

**File:** `lib/db/queries/settings.ts`

### `getCostingMethod()`

```
lib/db/queries/settings.ts:64
```

- Gets current org scope via `getCurrentScope()`
- Reads `organisations.costing_method` for `scope.organisationId`
- Falls back to `"weighted"` if row missing, column null, or error
- Returns `CostingMethod` → `"weighted" | "fifo"`
- Used by: `app/(app)/admin/settings/page.tsx` (loaded at render time)

### `getEffectivePayoutAccount(branchId)`

```
lib/db/queries/settings.ts:79
```

- Reads BOTH tables in parallel:
  - `branches(payout_account_name, payout_account_number, payout_bank_name)` for the given `branchId`
  - `organisations(payout_account_name, payout_account_number, payout_bank_name)` for current org
- **Resolution logic:** if branch has ANY of the three payout fields set → return branch payout; otherwise → return org payout
- Returns `PayoutAccount | null`
- Used by: **invoice renderer** (sales invoice print view) — determines where to direct customer payment

---

## Summary: what lives where

| Concern | Route | Layout/sidebar |
|---------|-------|----------------|
| Org overview, org-wide metrics, branch Enter | `/org`, `/org/sales`, `/org/ledger` | `app/(org)/layout.tsx` + `OrgSidebar` |
| Org payout, branch payout overrides, costing method | `/admin/settings` | `app/(app)/layout.tsx` + shared `Sidebar` |

The `/org` route group has its own sidebar (`OrgSidebar`) with no "Settings" link. The existing Settings page is inside the `(app)` route group (the branch-context sidebar) at `/admin/settings`. If you want a Settings entry in the org sidebar, it would need to be added to `ORG_NAV` in `components/org/org-sidebar.tsx` and either:
- (a) Linked to the existing `/admin/settings`, or
- (b) Built as a new `/org/settings` page inside the `(org)` route group

---

*Generated: 2026-07-26. No files modified.*
