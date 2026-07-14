import { requireRole } from "@/lib/auth/guards"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getProducts } from "@/lib/db/queries/products"
import { getOrgBranches } from "@/lib/db/queries/vendors"
import { ProductsClient } from "./products-client"

export default async function ProductsPage() {
  const scope = await requireRole("owner", "inventory")
  const [rawProducts, branches] = await Promise.all([getProducts(), getOrgBranches()])

  // Resolve branch: scope-bound member → single branch → null (multi-branch owner sees all)
  let resolvedBranchId: string | null = null
  if (scope.branchId) {
    resolvedBranchId = scope.branchId
  } else if (branches.length === 1) {
    resolvedBranchId = branches[0].id
  }

  // Find which products have at least one ledger entry in the resolved branch.
  const supabase = await createAppServerClient()
  let historyProductIds = new Set<string>()

  if (rawProducts.length > 0) {
    const productIds = rawProducts.map((p) => p.id)
    const historyQuery = supabase
      .from("stock_ledger")
      .select("product_id")
      .in("product_id", productIds)

    const { data: ledgerRows } = resolvedBranchId
      ? await historyQuery.eq("branch_id", resolvedBranchId)
      : await historyQuery

    if (ledgerRows) {
      historyProductIds = new Set((ledgerRows as { product_id: string }[]).map((r) => r.product_id))
    }
  }

  const products = rawProducts.map((p) => ({
    ...p,
    hasHistory: historyProductIds.has(p.id),
  }))

  return (
    <ProductsClient
      products={products}
      resolvedBranchId={resolvedBranchId}
      branches={branches}
    />
  )
}
