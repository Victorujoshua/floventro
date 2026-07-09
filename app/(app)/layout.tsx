import { getCurrentScope, getUserMemberships } from "@/lib/auth/scope"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { Sidebar } from "@/components/app/sidebar/sidebar"
import { AppHeader } from "@/components/app/header/app-header"
import type { WorkspaceMembership } from "@/components/app/header/app-header"
import { getNotifications } from "@/lib/db/queries/dashboard"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const scope = await getCurrentScope()

  if (!scope) {
    return <>{children}</>
  }

  const supabase = await createAppServerClient()

  const [orgResult, userResult, notifications, rawMemberships] = await Promise.all([
    supabase.from("organisations").select("name").eq("id", scope.organisationId).maybeSingle(),
    supabase.auth.getUser(),
    getNotifications(),
    getUserMemberships(),
  ])

  const user = userResult.data.user
  const userName = (user?.user_metadata?.full_name as string | undefined) ?? ""
  const userEmail = user?.email ?? ""

  // Map Supabase join result to a clean type (handles both array and object join shapes)
  const memberships: WorkspaceMembership[] = rawMemberships.map((m) => {
    const orgs = m.organisations
    const orgName = Array.isArray(orgs)
      ? (orgs[0] as { name?: string } | undefined)?.name ?? ""
      : (orgs as { name?: string } | null)?.name ?? ""

    const brs = m.branches
    const branchName = Array.isArray(brs)
      ? (brs[0] as { name?: string } | undefined)?.name ?? null
      : (brs as { name?: string } | null)?.name ?? null

    return {
      id: m.id as string,
      organisationId: m.organisation_id as string,
      branchId: (m.branch_id as string | null) ?? null,
      role: m.role as string,
      orgName,
      branchName,
    }
  })

  const pastDueCount = notifications.filter((n) => n.kind === "past_due").length

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <Sidebar role={scope.role} pastDueCount={pastDueCount} />
      <div className="ml-60 flex flex-1 flex-col min-w-0">
        <AppHeader
          orgName={orgResult.data?.name ?? ""}
          role={scope.role}
          userName={userName}
          userEmail={userEmail}
          notifications={notifications}
          memberships={memberships}
        />
        <main className="flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  )
}
