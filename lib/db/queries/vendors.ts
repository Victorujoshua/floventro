import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export async function getVendors() {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("vendors")
    .select(
      "id, organisation_id, branch_id, name, contact_person, phone, email, tin, cac_registration, notes, created_at, updated_at",
    )
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error) return []
  return data
}

export async function getOrgBranches() {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("branches")
    .select("id, name")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error) return []
  return data
}
