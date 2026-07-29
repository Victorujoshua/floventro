import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export async function getProducts() {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  let query = supabase
    .from("products")
    .select(
      "id, sku, name, description, reorder_point, unit_cost_cents, default_price_cents, created_at, updated_at, product_stock(branch_id, quantity)",
    )
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (scope.branchId) {
    // When inside a branch, show only products this branch carries (branch_products join table).
    // After app_0043 backfill every existing pair is listed, so this is visually inert on deploy.
    const { data: carried } = await supabase
      .from("branch_products")
      .select("product_id")
      .eq("branch_id", scope.branchId)

    const carriedIds = (carried ?? []).map((r: { product_id: string }) => r.product_id)
    if (carriedIds.length === 0) return []
    query = query.in("id", carriedIds)
  }

  const { data, error } = await query

  if (error) return []

  type RawProduct = {
    product_stock: { branch_id: string; quantity: number }[]
    id: string
    sku: string
    name: string
    description: string | null
    reorder_point: number
    unit_cost_cents: number | null
    default_price_cents: number | null
    created_at: string
    updated_at: string
  }

  // When inside a branch, show only that branch's quantity.
  // When at org level (branchId null), sum across all branches.
  const branchId = scope.branchId
  return (data as RawProduct[]).map(({ product_stock, ...p }) => ({
    ...p,
    stock: (product_stock ?? [])
      .filter((s) => !branchId || s.branch_id === branchId)
      .reduce((sum: number, s) => sum + s.quantity, 0),
  }))
}
