import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export type BranchRow = {
  id: string
  name: string
  createdAt: string
}

export async function getOrgBranchRows(): Promise<BranchRow[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("branches")
    .select("id, name, created_at")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })

  if (error) return []

  return (data as { id: string; name: string; created_at: string }[]).map((b) => ({
    id: b.id,
    name: b.name,
    createdAt: b.created_at,
  }))
}
