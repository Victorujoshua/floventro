import { requireRole } from "@/lib/auth/guards"
import { getOrgBranches } from "@/lib/db/queries/vendors"
import { getVendorsForBranch, getProductsForOrg } from "@/lib/db/queries/invoices"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { InvoiceForm } from "../invoice-form"

export default async function NewInvoicePage() {
  const scope = await requireRole("owner", "inventory")

  // Determine the effective branch for this form.
  let branchId = scope.branchId ?? null
  const branches = await getOrgBranches()

  if (!branchId) {
    if (branches.length === 1) {
      branchId = branches[0].id
    }
    // If multiple branches and no branchId, the form will show a branch selector.
  }

  // Vendors are branch-scoped. If we know the branch, pre-filter; otherwise load all
  // accessible vendors (RLS scopes them) for the multi-branch owner case.
  let vendors: { id: string; name: string }[] = []
  if (branchId) {
    vendors = await getVendorsForBranch(branchId)
  } else {
    // Multi-branch owner: load vendors for all readable branches via the base query.
    const supabase = await createAppServerClient()
    const { data } = await supabase
      .from("vendors")
      .select("id, name, branch_id")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)
      .order("name", { ascending: true })
    vendors = data ?? []
  }

  const products = await getProductsForOrg()

  return (
    <InvoiceForm
      vendors={vendors}
      products={products}
      resolvedBranchId={branchId}
      branches={branches.length > 1 ? branches : []}
    />
  )
}
