import { requireRole } from "@/lib/auth/guards"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getMembers, getPendingInvites } from "@/lib/db/queries/team"
import { getOrgBranches } from "@/lib/db/queries/vendors"
import { TeamClient } from "./team-client"

export default async function TeamPage() {
  const scope = await requireRole("owner", "admin")

  const supabase = await createAppServerClient()
  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", scope.organisationId)
    .maybeSingle()

  const [members, invites, branches] = await Promise.all([
    getMembers(),
    getPendingInvites(),
    getOrgBranches(),
  ])

  return (
    <TeamClient
      orgName={org?.name ?? ""}
      members={members}
      invites={invites}
      branches={branches}
      canInviteAdmin={scope.role === "owner"}
    />
  )
}
