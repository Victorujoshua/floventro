import { redirect } from "next/navigation"
import { requireRole } from "@/lib/auth/guards"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getMembers, getPendingInvites } from "@/lib/db/queries/team"
import { TeamClient } from "./team-client"

export default async function TeamPage() {
  const scope = await requireRole("owner", "admin")

  // Inviting is branch-scoped — can't invite without being inside a branch.
  if (!scope.branchId) {
    redirect("/org")
  }

  const supabase = await createAppServerClient()
  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", scope.organisationId)
    .maybeSingle()

  const [members, invites] = await Promise.all([
    getMembers(),
    getPendingInvites(),
  ])

  return (
    <TeamClient
      orgName={org?.name ?? ""}
      members={members}
      invites={invites}
      canInviteAdmin={scope.role === "owner"}
    />
  )
}
