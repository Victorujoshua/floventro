# Phase 1 — Manual Verification Checklist

Run these tests on **app.floventro.com** after each deploy. Tests must be run through the app (anon key + user session) — never through Supabase Studio, which bypasses RLS and gives false passes.

---

## Test A — Two-user isolation

Goal: confirm each user sees only their own org.

1. Open **Incognito Window 1** → sign up as `alpha@test.com`, create org "Alpha Corp"
2. Open **Incognito Window 2** → sign up as `beta@test.com`, create org "Beta Corp"
3. In each window visit `/debug-rls`

**Expected:**
- Alpha window: organisations count = 1, shows Alpha Corp's ID
- Beta window: organisations count = 1, shows Beta Corp's ID
- Neither window shows the other's org ID, branch ID, or membership ID

**Pass / Fail:** ___

---

## Test B — RLS denial via /debug-rls

Goal: confirm the anon-key client cannot read another user's rows.

1. Log in as User A → visit `/debug-rls` → note organisation_id
2. Log in as User B (different window/profile) → visit `/debug-rls`

**Expected:**
- User B's page shows zero rows for User A's org
- Memberships count reflects only User B's memberships

**Pass / Fail:** ___

> `/debug-rls` is disabled on production (`NEXT_PUBLIC_APP_ENV=production`).
> Use a preview/dev deploy, or temporarily set `NEXT_PUBLIC_APP_ENV=preview` on the Vercel app project.

---

## Test C — Role cookie tamper

Goal: confirm `requireScope` rejects a forged cookie gracefully.

1. Log in as an owner → open `/dashboard` → confirm it loads
2. Open DevTools → Application → Cookies → find `floventro_role`
3. Change its value to `sales`
4. Reload `/dashboard`

**Expected:**
- `getCurrentScope` finds no matching membership for role=sales
- Falls back to the user's highest-priority real membership (owner)
- Dashboard still renders with the correct owner scope
- (No 500, no redirect loop)

**Pass / Fail:** ___

---

## Test D — Logout clears scope cookies

Goal: confirm logout clears session + scope cookies and enforces the auth guard.

1. Log in → visit `/dashboard` → confirm it loads
2. Trigger logout (visit `/logout` or use the logout action)
3. Attempt to visit `/dashboard` directly

**Expected:**
- After logout: redirected to `/login`
- `floventro_org`, `floventro_branch`, `floventro_role` cookies are cleared (check DevTools)
- Pasting the dashboard URL directly while logged out → redirect to `/login`, not a crash

**Pass / Fail:** ___

---

## Test E — Onboarding guard (no double-create)

Goal: confirm a user with an existing org cannot re-submit the create-org form.

1. Log in as a user who already has an org
2. Navigate directly to `/onboarding/create-org`

**Expected:** immediately redirected to `/dashboard` (not shown the create-org form)

**Pass / Fail:** ___

---

## Sign-off

| Test | Result | Notes |
|------|--------|-------|
| A — Two-user isolation | | |
| B — RLS denial | | |
| C — Role cookie tamper | | |
| D — Logout | | |
| E — Onboarding guard | | |

All tests must pass before Phase 2 work begins.
