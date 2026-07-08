import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"
import { getProducts } from "./products"

export { getProducts as getProductsForOrg }

export async function getVendorsForBranch(branchId: string) {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("branch_id", branchId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error) return []
  return data
}
