import { redirect } from "next/navigation"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope, type Scope, type Role } from "./scope"

/**
 * Ensures the user is authenticated. Returns userId or redirects to /login.
 */
export async function requireAuth(): Promise<string> {
  const supabase = await createAppServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  return user.id
}

/**
 * Ensures the user has a valid scope. Returns the scope or redirects:
 * - Unauthenticated → /login
 * - Authenticated but no memberships → /onboarding/create-org
 */
export async function requireScope(): Promise<Scope> {
  const supabase = await createAppServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const scope = await getCurrentScope()
  if (!scope) redirect("/onboarding/create-org")

  return scope
}

/**
 * Ensures the user's current scope role is in the allowed list.
 * Falls back to /dashboard if the role doesn't match (wrong-role access).
 */
export async function requireRole(...allowedRoles: Role[]): Promise<Scope> {
  const scope = await requireScope()
  if (!allowedRoles.includes(scope.role)) {
    redirect("/dashboard")
  }
  return scope
}

/**
 * Sugar for requireRole('owner').
 */
export async function requireOwner(): Promise<Scope> {
  return requireRole("owner")
}
