import { requireOwner } from "@/lib/auth/guards"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getOrgBranchRows } from "@/lib/db/queries/branches"
import { OrgSidebar } from "@/components/org/org-sidebar"

export default async function OrgLayout({ children }: { children: React.ReactNode }) {
  // Only owners can access /org — non-owners redirect to /dashboard.
  const scope = await requireOwner()

  const supabase = await createAppServerClient()
  const [orgResult, branches] = await Promise.all([
    supabase
      .from("organisations")
      .select("name")
      .eq("id", scope.organisationId)
      .maybeSingle(),
    getOrgBranchRows(),
  ])

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <OrgSidebar orgName={orgResult.data?.name ?? ""} branches={branches} />
      <div className="ml-60 flex flex-1 flex-col min-w-0">
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  )
}
