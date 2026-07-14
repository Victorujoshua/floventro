import { requireScope } from "@/lib/auth/guards"
import { getMyRequests } from "@/lib/db/queries/requests"
import { getProductsForOrg } from "@/lib/db/queries/invoices"
import { getOrgBranches } from "@/lib/db/queries/vendors"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { RequestsClient } from "./requests-client"

export default async function RequestsPage() {
  const scope = await requireScope()

  const [myRequests, products, branches] = await Promise.all([
    getMyRequests(),
    getProductsForOrg(),
    getOrgBranches(),
  ])

  // Resolve branch the same way as the invoice form.
  let resolvedBranchId: string | null = scope.branchId ?? null
  if (!resolvedBranchId && branches.length === 1) {
    resolvedBranchId = branches[0].id
  }

  // Multi-branch owner needs branch selector; single-branch or scoped members don't.
  const branchChoices = !resolvedBranchId && branches.length > 1 ? branches : []

  return (
    <RequestsClient
      myRequests={myRequests}
      products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name }))}
      resolvedBranchId={resolvedBranchId}
      branches={branchChoices}
    />
  )
}
