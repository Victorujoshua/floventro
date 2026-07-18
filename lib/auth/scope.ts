import { cookies } from "next/headers"
import { createAppServerClient } from "@/lib/supabase/app-server"

export type Role = "owner" | "inventory" | "sales" | "internal_use"

export type Scope = {
  userId: string
  organisationId: string
  branchId: string | null
  role: Role
}

const COOKIE_ORG = "floventro_org"
const COOKIE_BRANCH = "floventro_branch"
const COOKIE_ROLE = "floventro_role"

const ROLE_PRIORITY: Record<Role, number> = {
  owner: 0,
  inventory: 1,
  sales: 2,
  internal_use: 3,
}

/**
 * Reads current scope from cookies. Falls back to the user's first membership
 * (by role priority) if cookies are missing or don't match a real membership.
 * Returns null if unauthenticated or if the user has no memberships.
 */
export async function getCurrentScope(): Promise<Scope | null> {
  try {
  const supabase = await createAppServerClient()

  const { data: scopeData, error: scopeUserError } = await supabase.auth.getUser()
  if (scopeUserError || !scopeData?.user) return null
  const user = scopeData.user

  const { data: memberships } = await supabase
    .from("memberships")
    .select("organisation_id, branch_id, role")
    .eq("user_id", user.id)
    .is("deleted_at", null)

  if (!memberships || memberships.length === 0) return null

  const cookieStore = await cookies()
  const requestedOrg = cookieStore.get(COOKIE_ORG)?.value
  const requestedBranch = cookieStore.get(COOKIE_BRANCH)?.value ?? null
  const requestedRole = cookieStore.get(COOKIE_ROLE)?.value

  // Try to match the requested scope from cookies against actual memberships.
  if (requestedOrg && requestedRole) {
    const match = memberships.find(
      (m) =>
        m.organisation_id === requestedOrg &&
        (m.branch_id ?? null) === requestedBranch &&
        m.role === requestedRole,
    )
    if (match) {
      return {
        userId: user.id,
        organisationId: match.organisation_id,
        branchId: match.branch_id,
        role: match.role as Role,
      }
    }

    // ── Owner branch-entry: a branch cookie is set but no exact row matches ──
    // Owner memberships have branch_id = NULL, so the match above never fires
    // when a branch cookie is present. Re-validate with two explicit checks:
    // (1) the caller is an owner of requestedOrg, (2) the branch still exists
    // in that same org. If the branch was deleted, fall back to org-level scope.
    if (requestedRole === "owner" && requestedBranch) {
      const ownerMembership = memberships.find(
        (m) =>
          m.organisation_id === requestedOrg &&
          m.role === "owner" &&
          m.branch_id === null,
      )
      if (ownerMembership) {
        const { data: branch } = await supabase
          .from("branches")
          .select("id")
          .eq("id", requestedBranch)
          .eq("organisation_id", requestedOrg) // tenant-isolation: must be in the same org
          .is("deleted_at", null)
          .maybeSingle()

        return {
          userId: user.id,
          organisationId: requestedOrg,
          branchId: branch ? requestedBranch : null, // null if branch was deleted
          role: "owner",
        }
      }
    }
  }

  // Fall back to the highest-priority membership (deterministic).
  const sorted = [...memberships].sort(
    (a, b) =>
      (ROLE_PRIORITY[a.role as Role] ?? 99) -
      (ROLE_PRIORITY[b.role as Role] ?? 99),
  )
  const first = sorted[0]

  return {
    userId: user.id,
    organisationId: first.organisation_id,
    branchId: first.branch_id,
    role: first.role as Role,
  }
  } catch (err) {
    console.error("[getCurrentScope] failed:", err instanceof Error ? err.stack : JSON.stringify(err))
    return null
  }
}

/**
 * Persists the requested scope in cookies after validating it against the
 * user's actual memberships. Returns false if the scope isn't real.
 */
export async function setCurrentScope(scope: {
  organisationId: string
  branchId: string | null
  role: Role
}): Promise<boolean> {
  const supabase = await createAppServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false

  // ── Owner branch-entry path ───────────────────────────────────────────────
  // Owner memberships have branch_id = NULL (org-wide), so the exact-membership
  // query below would reject any non-null branchId for an owner. This path
  // handles that case with two explicit tenant-isolation checks instead.
  if (scope.role === "owner" && scope.branchId !== null) {
    // 1. Verify the caller has an active owner membership in this org.
    //    This is a branch_id IS NULL membership — the canonical owner row.
    const { data: ownerMembership } = await supabase
      .from("memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("organisation_id", scope.organisationId)
      .eq("role", "owner")
      .is("branch_id", null)
      .is("deleted_at", null)
      .maybeSingle()

    if (!ownerMembership) return false

    // 2. Verify the target branch EXISTS and belongs to THE SAME ORG the
    //    owner owns. "branch exists" alone is insufficient — this eq on
    //    organisation_id is the tenant-isolation guard that prevents an owner
    //    of org A from entering a branch belonging to org B.
    const { data: branch } = await supabase
      .from("branches")
      .select("id")
      .eq("id", scope.branchId)
      .eq("organisation_id", scope.organisationId) // ← must match the owned org
      .is("deleted_at", null)
      .maybeSingle()

    if (!branch) return false

    // Both checks passed — write cookies with the entered branch.
    const cookieStore = await cookies()
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    }
    cookieStore.set(COOKIE_ORG, scope.organisationId, cookieOpts)
    cookieStore.set(COOKIE_ROLE, scope.role, cookieOpts)
    cookieStore.set(COOKIE_BRANCH, scope.branchId, cookieOpts)
    return true
  }

  // ── All other cases: exact-membership validation (UNCHANGED) ─────────────
  // Non-owner roles (inventory / sales / internal_use) and owner clearing
  // their entered branch (branchId = null) must match an exact membership row.
  // Nothing below this line changed from the original implementation.
  let query = supabase
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("organisation_id", scope.organisationId)
    .eq("role", scope.role)
    .is("deleted_at", null)

  if (scope.branchId !== null) {
    query = query.eq("branch_id", scope.branchId)
  } else {
    query = query.is("branch_id", null)
  }

  const { data: matches } = await query

  if (!matches || matches.length === 0) return false

  const cookieStore = await cookies()
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  }

  cookieStore.set(COOKIE_ORG, scope.organisationId, cookieOpts)
  cookieStore.set(COOKIE_ROLE, scope.role, cookieOpts)

  if (scope.branchId) {
    cookieStore.set(COOKIE_BRANCH, scope.branchId, cookieOpts)
  } else {
    cookieStore.delete(COOKIE_BRANCH)
  }

  return true
}

/**
 * Returns all memberships for the current user, including org and branch names,
 * for populating the scope switcher UI.
 */
export async function getUserMemberships() {
  const supabase = await createAppServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data: memberships } = await supabase
    .from("memberships")
    .select(
      `
      id,
      organisation_id,
      branch_id,
      role,
      organisations ( name ),
      branches ( name )
    `,
    )
    .eq("user_id", user.id)
    .is("deleted_at", null)

  return memberships ?? []
}
