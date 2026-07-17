import "server-only"
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

export async function getInvoices() {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("vendor_invoices")
    .select(
      "id, invoice_number, invoice_date, due_date, total_cents, amount_paid_cents, status, created_at, vendors(name)",
    )
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("invoice_date", { ascending: false })

  if (error) return []
  return data
}
