import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { createAppServiceRoleClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export type Member = {
  id: string
  userId: string
  email: string
  name: string
  role: string
  branchName: string | null
  createdAt: string
}

export type PendingInvite = {
  id: string
  email: string
  role: string
  branchName: string | null
  expiresAt: string
  daysLeft: number
  token: string
}

function resolveName(raw: unknown): string | null {
  if (!raw) return null
  if (Array.isArray(raw)) return (raw[0] as { name?: string })?.name ?? null
  return (raw as { name?: string }).name ?? null
}

export async function getMembers(): Promise<Member[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  let query = supabase
    .from("memberships")
    .select("id, user_id, role, branch_id, created_at, branches(name)")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })

  // When an owner has entered a specific branch, scope the list to that branch
  // (members of that branch plus owners who span the whole org).
  if (scope.branchId) {
    query = query.or(`branch_id.eq.${scope.branchId},branch_id.is.null`)
  }

  const { data: memberships, error } = await query

  if (error || !memberships) return []

  // Fetch emails + names for each member using service-role admin API
  const adminClient = createAppServiceRoleClient()
  const userIds = [...new Set((memberships as { user_id: string }[]).map((m) => m.user_id))]

  const userInfos = await Promise.all(
    userIds.map(async (uid) => {
      const { data } = await adminClient.auth.admin.getUserById(uid)
      return {
        id: uid,
        email: data.user?.email ?? "",
        name: (data.user?.user_metadata?.full_name as string) ?? "",
      }
    }),
  )
  const userMap = new Map(userInfos.map((u) => [u.id, u]))

  return (memberships as {
    id: string
    user_id: string
    role: string
    branch_id: string | null
    created_at: string
    branches: unknown
  }[]).map((m) => ({
    id: m.id,
    userId: m.user_id,
    email: userMap.get(m.user_id)?.email ?? "",
    name: userMap.get(m.user_id)?.name ?? "",
    role: m.role,
    branchName: resolveName(m.branches),
    createdAt: m.created_at,
  }))
}

export async function getPendingInvites(): Promise<PendingInvite[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from("invitations")
    .select("id, email, role, branch_id, expires_at, token, branches(name)")
    .eq("organisation_id", scope.organisationId)
    .eq("status", "pending")
    .gt("expires_at", now)
    .order("created_at", { ascending: false })

  if (error || !data) return []

  return (data as {
    id: string
    email: string
    role: string
    branch_id: string | null
    expires_at: string
    token: string
    branches: unknown
  }[]).map((inv) => {
    const daysLeft = Math.max(
      0,
      Math.ceil((new Date(inv.expires_at).getTime() - Date.now()) / 86_400_000),
    )
    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      branchName: resolveName(inv.branches),
      expiresAt: inv.expires_at,
      daysLeft,
      token: inv.token,
    }
  })
}
