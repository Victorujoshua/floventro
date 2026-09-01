# Admin Role Audit
> Read-only investigation. No changes applied. STOP after this file.
>
> Proposed role: **admin** — owner-level access scoped to ONE branch.
> Full branch operations + can invite sales/inventory/internal_use (not other admins).
> Can NOT manage org settings, create branches, or access /org views.

---

## 1. Role Definition

### Location
`supabase/migrations/app_0001_core.sql:38`

```sql
role text not null check (role in ('owner', 'inventory', 'sales', 'internal_use'))
```

**Type: CHECK constraint** (not a Postgres ENUM). Changing it requires dropping and re-adding the constraint — no `ALTER TYPE ADD VALUE`.

### Second definition (must also change)
`supabase/migrations/app_0013_invitations.sql:17`

```sql
role text not null check (role in ('owner','inventory','sales','internal_use'))
```

### What the migration looks like

```sql
-- memberships
ALTER TABLE public.memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('owner', 'inventory', 'sales', 'internal_use', 'admin'));

-- invitations
ALTER TABLE public.invitations DROP CONSTRAINT invitations_role_check;
ALTER TABLE public.invitations ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('owner', 'inventory', 'sales', 'internal_use', 'admin'));
```

> Note: actual constraint names must be verified against the live DB — the migration files use inline `check ()` without explicit constraint names. Use `\d memberships` in psql to confirm names before issuing the ALTER.

---

## 2. RLS Helper Functions (CRITICAL)

All are SECURITY DEFINER. Defined in migrations; live in `public` schema.

### 2a. `user_owned_org_ids()` — app_0005
**Body:** Returns org_ids where `role = 'owner'`.

```sql
select organisation_id from memberships
where user_id = auth.uid() and role = 'owner' and deleted_at is null;
```

**Used by:**
- `memberships` SELECT policy ("read own memberships")
- `invitations` SELECT / INSERT / UPDATE policies (all three)

**Admin verdict: DO NOT ADD.** This helper is intentionally owner-only. Admin is branch-scoped and should not gain the ability to manage org-level invitations or see all org memberships through this helper.

---

### 2b. `user_member_org_ids()` — app_0007
**Body:** Returns org_ids where user has ANY active membership (any role).

```sql
select organisation_id from memberships
where user_id = auth.uid() and deleted_at is null;
```

**Used by:** `products` SELECT, `service_types` SELECT.

**Admin verdict: No change needed.** Admin has a membership → automatically returns their org. Works as-is.

---

### 2c. `user_product_write_org_ids()` — app_0007
**Body:** Returns org_ids where user has `owner` OR `inventory` role.

```sql
select organisation_id from memberships
where user_id = auth.uid()
  and role in ('owner', 'inventory')
  and deleted_at is null;
```

**Used by:** `products` INSERT/UPDATE, `service_types` INSERT/UPDATE.

**Admin verdict: ADD 'admin'.** Admin has full branch operations — managing the product catalogue is included. Products are org-scoped (no branch column), so this works: admin can write products for their org. Change to `role in ('owner', 'inventory', 'admin')`.

---

### 2d. `user_vendor_read_branch_ids()` — app_0009
**Body:** Direct branch memberships (any role) UNION all branches in owned orgs.

```sql
select branch_id from memberships
where user_id = auth.uid() and branch_id is not null and deleted_at is null
UNION
select b.id from branches b where b.deleted_at is null
  and b.organisation_id in (
    select organisation_id from memberships
    where user_id = auth.uid() and role = 'owner' and deleted_at is null
  );
```

**Used by:** `vendors` SELECT, `product_stock` SELECT, `stock_ledger` SELECT, `vendor_invoices` SELECT, `user_readable_invoice_ids()` (which gates `vendor_invoice_lines` SELECT).

**Admin verdict: No change needed.** Admin has `branch_id IS NOT NULL` in memberships → already returned by the first leg. Works as-is.

---

### 2e. `user_vendor_write_branch_ids()` — app_0009 ← **MOST CRITICAL**
**Body:** Branches where user has `inventory` role UNION all branches in owned orgs.

```sql
select branch_id from memberships
where user_id = auth.uid()
  and role = 'inventory'
  and branch_id is not null
  and deleted_at is null
UNION
select b.id from branches b where b.deleted_at is null
  and b.organisation_id in (
    select organisation_id from memberships
    where user_id = auth.uid() and role = 'owner' and deleted_at is null
  );
```

**Used by (direct or indirect):**
- `vendors` INSERT/UPDATE
- `vendor_invoices` INSERT/UPDATE
- `staff_holdings` SELECT (manager half: `branch_id in (user_vendor_write_branch_ids())`)
- `user_readable_invoice_ids()` → `vendor_invoice_lines` SELECT
- `user_readable_service_ids()` → `service_records` SELECT, `service_consumption` SELECT
- RPCs: `record_service_usage`, `return_to_branch`, `review_stock_request` — these call this helper inside their membership gate

**Admin verdict: ADD 'admin'.** This is the single most important helper. Every write path for branch operations (invoices, vendors, holdings visibility, service records visibility) flows through this function. Change the first leg to `role in ('inventory', 'admin')`.

---

### 2f. `user_readable_invoice_ids()` — app_0011
**Body:** Calls `user_vendor_read_branch_ids()` internally. No direct role reference.

**Used by:** `vendor_invoice_lines` SELECT.

**Admin verdict: No change needed.** Automatically correct once 2d is unchanged (admin already in read branch ids).

---

### 2g. `user_readable_service_ids()` — app_0026
**Body:** Returns service_record IDs where `performed_by = auth.uid()` OR `branch_id in (user_vendor_write_branch_ids())`.

**Used by:** `service_records` SELECT, `service_consumption` SELECT.

**Admin verdict: No change needed directly.** Will work once `user_vendor_write_branch_ids()` includes admin (2e above).

---

## 3. RLS Policies That Reference Role Directly

These are policies that inline a role check rather than delegating to a helper.

| Migration | Policy | Role check | Admin? |
|-----------|---------|-----------|--------|
| app_0002 | `"update own org"` on `organisations` | `role = 'owner'` | **No** — org settings are owner-only |
| app_0002 | `"insert branches as owner"` on `branches` | `role = 'owner'` | **No** — branch creation is owner-only |
| app_0002 | `"update branches as owner"` on `branches` | `role = 'owner'` | **No** — branch updates are owner-only |
| app_0005 | `"read own memberships"` on `memberships` | `user_id = auth.uid() OR org in (user_owned_org_ids())` | **Partial** — admin reads their own row via `user_id = auth.uid()`. But admin CANNOT see other memberships (needed for team management UI). See §5 below. |
| app_0014 | `"owners can view org invitations"` | `org in (user_owned_org_ids())` | **Needs new logic** — admin must see invitations they created in their branch. See §5. |
| app_0014 | `"owners can create invitations"` | `org in (user_owned_org_ids())` | **Needs new logic** — admin needs insert access for lower roles. See §5. |
| app_0014 | `"owners can update invitations"` | `org in (user_owned_org_ids())` | **Needs new logic** — admin needs revoke access for invitations they own. See §5. |

---

## 4. App-Level Role Checks

### 4a. `lib/auth/scope.ts`

| Location | Current | Admin treatment |
|----------|---------|----------------|
| Line 4: `type Role` | `"owner" \| "inventory" \| "sales" \| "internal_use"` | Add `\| "admin"` |
| Lines 17-22: `ROLE_PRIORITY` | owner=0, inventory=1, sales=2, internal_use=3 | Add `admin: 1` (same priority tier as inventory; adjust others: sales→2, internal_use→3) |
| Lines 72-95: owner branch-entry special case | `if (requestedRole === "owner" && requestedBranch)` — re-validates against null-branch_id owner row | Admin has `branch_id IS NOT NULL` in memberships — goes through normal exact-membership path. **No change needed.** |
| `setCurrentScope()` lines 138-180: owner special path | Only fires for `scope.role === "owner" && scope.branchId !== null` | Admin has non-null branchId + role='admin' → falls through to exact-membership query. **No change needed.** |

### 4b. `lib/auth/guards.ts`

| Guard | Current | Admin treatment |
|-------|---------|----------------|
| `requireOwner()` | Sugar for `requireRole('owner')` | Owner-only calls stay as-is. Admin does NOT become owner. |
| `requireRole(...roles)` | Generic — checks `scope.role` | Works automatically once Role type includes 'admin'. |
| `requireScope()` | No role check | No change needed. |

### 4c. `lib/db/actions/` — Server Actions

| File | Function(s) | Current guard | Admin? |
|------|------------|---------------|--------|
| `vendors.ts` | createVendor, updateVendor, deleteVendor | `requireRole("owner", "inventory")` | **Add "admin"** |
| `invoices.ts` | createInvoice, getInvoiceForReceiving, receiveInvoice | `requireRole("owner", "inventory")` | **Add "admin"** |
| `payments.ts` | recordInvoicePayment, getInvoicePayments | `requireRole("owner", "inventory")` | **Add "admin"** |
| `products.ts` | createProduct, updateProduct, deleteProduct | `requireRole("owner", "inventory")` | **Add "admin"** |
| `transfers.ts` | initiateTransfer, cancelTransfer, receiveTransfer | `requireRole("owner", "inventory")` | **Add "admin"** |
| `adjustments.ts` | createAdjustment | `requireRole("owner", "inventory")` | **Add "admin"** |
| `requests.ts` | reviewStockRequest | `requireRole("owner", "inventory")` | **Add "admin"** |
| `services.ts` | createServiceType, updateServiceType | `requireRole("owner", "inventory")` | **Add "admin"** |
| `services.ts` | recordServiceUsageAction | `requireScope()` | No change — any member can record usage |
| `sales.ts` | recordSaleAction | `requireScope()` | No change — any member can record a sale |
| `sales.ts` | recordSalePaymentAction | `requireRole("owner", "inventory")` | **Add "admin"** |
| `team.ts` | inviteMemberAction | `requireOwner()` | **Change to `requireRole("owner", "admin")`** + add guard: if `scope.role === "admin"`, reject `role === "admin"` in input |
| `team.ts` | revokeInviteAction | `requireOwner()` | **Change to `requireRole("owner", "admin")`** + scope the revoke to invitations in the admin's branch |
| `settings.ts` | All 3 payout/costing actions | `requireOwner()` | Owner-only. **Do not add admin.** |
| `branches.ts` | createBranch, updateBranch | `requireOwner()` | Owner-only. **Do not add admin.** |
| `org.ts` | updateOrgAction | `scope.role !== "owner"` (inline) | Owner-only. **Do not add admin.** |

### 4d. `app/(app)` pages — Server Components

| Page | Guard | Admin? |
|------|-------|--------|
| `admin/team/page.tsx` | `requireOwner()` | **Change to `requireRole("owner", "admin")`** |
| `admin/settings/page.tsx` | `requireOwner()` | Owner-only. **Do not add admin.** |
| `admin/branches/page.tsx` | `requireOwner()` | Owner-only. **Do not add admin.** |
| `inventory/invoices/page.tsx` | `requireRole("owner", "inventory")` | **Add "admin"** |
| `inventory/invoices/new/page.tsx` | `requireRole("owner", "inventory")` | **Add "admin"** |
| `inventory/vendors/page.tsx` | `requireRole("owner", "inventory")` | **Add "admin"** |
| `inventory/products/page.tsx` | `requireRole("owner", "inventory")` | **Add "admin"** |
| `inventory/products/[id]/history/page.tsx` | `requireRole("owner", "inventory")` | **Add "admin"** |
| `inventory/holdings/page.tsx` | `requireRole("owner", "inventory")` | **Add "admin"** |
| `inventory/requests/page.tsx` | `requireRole("owner", "inventory")` | **Add "admin"** |
| `inventory/transfers/page.tsx` | `requireRole("owner", "inventory")` | **Add "admin"** |
| `inventory/services/page.tsx` | `requireRole("owner", "inventory")` | **Add "admin"** |
| `dashboard/page.tsx` line 40 | `scope.role === "owner" && scope.branchId === null` → redirect /org | Admin always has branchId. **No change needed.** |
| `dashboard/page.tsx` line 44 | `isInventoryUser = role === "owner" \|\| role === "inventory"` | **Add `\|\| scope.role === "admin"`** — admin sees full inventory dashboard (stock on hand, payables, low stock, invoices, chart) |
| `inventory/transfers/page.tsx` line 11 | `scope.role === "owner" && !scope.branchId` → redirect /org | Admin always has branchId. **No change needed.** |
| `(org)/layout.tsx` | `requireOwner()` | Owner-only. **Do not add admin.** (Admin cannot access /org views) |

---

## 5. Invite / Team Management

### The gap: memberships RLS vs. admin team management

The current `"read own memberships"` policy lets you see your own row OR all rows in orgs you own. Admin is branch-scoped and is NOT an org owner. If admin tries to render the Team page, the query for all org members will only return their own row (not the full team).

**Gap:** Admin needs to read memberships in their branch to power the Team UI. Options (for implementation phase, not decided here):
- A: Extend the `"read own memberships"` policy: `OR (branch_id = [admin's branch] AND org matches)` — requires a new helper to avoid recursion.
- B: Create a `get_branch_members(p_branch_id)` SECURITY DEFINER RPC that returns branch members, called from `lib/db/queries/team.ts` instead of a direct Supabase query.
- Option B is safer (no policy recursion risk).

### The gap: invitations RLS

All three invitations policies use `user_owned_org_ids()` (owner-only). Admin needs to:
- SELECT invitations they created (`invited_by = auth.uid()` AND `branch_id = their branch`)
- INSERT invitations for `sales`, `inventory`, `internal_use` (not `admin`) in their branch
- UPDATE (revoke) invitations they created

Options:
- A: Extend existing policies with an OR clause gating on `invited_by = auth.uid() AND branch_id IN (admin's branches)`.
- B: New separate policies for admin-scoped access.
- Both require a new SECURITY DEFINER helper (to avoid recursion querying memberships inside invitations policy).

### Invite schema

| Location | Current | Change |
|----------|---------|--------|
| `lib/validation/invites.ts:5` | `z.enum(["inventory", "sales", "internal_use"])` | Add `"admin"` — but only owner can select it. Two approaches: (a) one schema with `"admin"` + server-side guard in action, or (b) two schemas (ownerInviteSchema / adminInviteSchema) selected by role. Approach (a) is simpler. |
| `app/(app)/admin/team/team-client.tsx` line 34: `ROLE_OPTIONS` | `["inventory", "sales", "internal_use"]` | Conditionally add `{ value: "admin", label: "Admin" }` when the viewing user is owner. Requires passing viewer role as a prop. |

### Who can invite

| Role | Can invite | Cannot invite |
|------|-----------|---------------|
| owner | admin, inventory, sales, internal_use | — |
| admin | inventory, sales, internal_use | admin (blocked by server guard in `inviteMemberAction`) |
| inventory, sales, internal_use | Nobody | — |

---

## 6. Role Display / Labels

| Location | Current | Change |
|----------|---------|--------|
| `app/(app)/admin/team/team-client.tsx:40-44` `ROLE_LABELS` | `{ owner, inventory, sales, internal_use }` | Add `admin: "Admin"` |
| `app/(app)/admin/team/team-client.tsx:47-59` `RoleBadge` styles | 4 color entries | Add `admin: "bg-violet-50 text-violet-800"` (distinguish from owner's tint-violet) or similar |
| `components/app/header/app-header.tsx:165` | `capitalize` CSS on raw role string | `"admin"` → "Admin" via CSS. **No change needed.** |
| `components/app/header/app-header.tsx:186` | `{m.role}` raw string in workspace switcher | Same — "admin" is fine as-is. **No change needed.** |
| `components/org/org-sidebar.tsx:61` | Hardcoded `"Owner"` badge | Owner sidebar only. **No change needed.** |
| `components/app/sidebar/sidebar.tsx:33-88` `MAIN_MENU` and `MANAGEMENT_MENU` | `Record<Role, NavItem[]>` — exhaustive, 4 keys | **Must add `admin` key to both records.** TypeScript will error at compile time if the type is updated but these records are not. Admin nav = inventory nav (all items including Stock requests, Holdings, Transfers, Services). Management: add Team link (admin can manage team). |
| `components/marketing/role-picker.tsx:19-26` | Local `Role` type for marketing page only | Marketing page only — not connected to DB. Add `admin` if/when the marketing page should showcase admin persona. Low priority. |

---

## 7. Scope / Dashboard

### `lib/auth/scope.ts` — scope resolution

Admin has `branch_id IS NOT NULL` in the memberships table (a regular branch-scoped row, like `inventory` or `sales`). The scope resolution for admin flows through the **exact-membership match** path — no special case like the owner's null-branch handling.

**`getCurrentScope()`:**
- Cookie-based match: `memberships.find(m => m.organisation_id === requestedOrg && m.branch_id === requestedBranch && m.role === requestedRole)` — works for admin with non-null branchId.
- Owner special path (lines 72-95): only fires if `requestedRole === "owner"`. Admin never hits this. No change needed.
- Fallback sort: `ROLE_PRIORITY` sort — needs `admin` added (see §4a).

**`setCurrentScope()`:**
- Owner branch-entry path (lines 138-180): only fires if `scope.role === "owner" && scope.branchId !== null`. Admin has `role = "admin"` → falls to exact-membership query. No change needed.

### `app/(app)/dashboard/page.tsx`

| Line | Code | Change for admin |
|------|------|-----------------|
| 40 | `if (scope.role === "owner" && scope.branchId === null) redirect("/org")` | No change. Admin always has branchId. |
| 44 | `const isInventoryUser = scope.role === "owner" \|\| scope.role === "inventory"` | **Change to:** `const isInventoryUser = scope.role === "owner" \|\| scope.role === "inventory" \|\| scope.role === "admin"` |

Effect: admin sees the full inventory dashboard — Stock on hand, Outstanding payables, Low stock, Recent invoices, Stock received chart. Same as inventory role.

---

## Summary Map

### DB (SQL migrations needed)

| Change | Migration file |
|--------|---------------|
| Add 'admin' to `memberships.role` CHECK | new migration |
| Add 'admin' to `invitations.role` CHECK | new migration |
| `user_product_write_org_ids()`: add `'admin'` to role IN list | new migration |
| `user_vendor_write_branch_ids()`: add `'admin'` to first leg role IN list | new migration |
| New helper `user_admin_branch_ids()` or similar for memberships/invitations RLS | new migration |
| `"read own memberships"` policy: extend to branch-scoped members OR use RPC approach | new migration |
| Invitations policies: extend for admin (view/create/revoke in own branch) | new migration |

### TypeScript (source code changes needed)

| File | Change |
|------|--------|
| `lib/auth/scope.ts` | Add `"admin"` to `Role` type; add priority in `ROLE_PRIORITY` |
| `lib/db/actions/team.ts` | `inviteMemberAction`: `requireRole("owner","admin")` + guard against admin inviting admin; `revokeInviteAction`: `requireRole("owner","admin")` + branch scope |
| `lib/db/actions/vendors.ts` (×3) | Add `"admin"` to `requireRole` |
| `lib/db/actions/invoices.ts` (×3) | Add `"admin"` to `requireRole` |
| `lib/db/actions/payments.ts` (×2) | Add `"admin"` to `requireRole` |
| `lib/db/actions/products.ts` (×3) | Add `"admin"` to `requireRole` |
| `lib/db/actions/transfers.ts` (×3) | Add `"admin"` to `requireRole` |
| `lib/db/actions/adjustments.ts` (×1) | Add `"admin"` to `requireRole` |
| `lib/db/actions/requests.ts` (×1) | Add `"admin"` to `requireRole` |
| `lib/db/actions/services.ts` (×2 type CRUD) | Add `"admin"` to `requireRole` |
| `lib/db/actions/sales.ts` — `recordSalePaymentAction` | Add `"admin"` to `requireRole` |
| `lib/validation/invites.ts` | Add `"admin"` to role enum (with server-side enforcement) |
| `app/(app)/admin/team/page.tsx` | `requireRole("owner","admin")` |
| `app/(app)/inventory/*.tsx` (all 9 pages) | Add `"admin"` to `requireRole` |
| `app/(app)/dashboard/page.tsx` line 44 | Add `scope.role === "admin"` to `isInventoryUser` |
| `components/app/sidebar/sidebar.tsx` | Add `admin` key to `MAIN_MENU` and `MANAGEMENT_MENU` |
| `app/(app)/admin/team/team-client.tsx` | Add `admin` to `ROLE_LABELS`, `RoleBadge` styles, and conditionally to `ROLE_OPTIONS` |
