import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export type BranchStockRow = {
  productId: string
  name: string
  sku: string | null
  quantity: number
}

export async function getBranchStock(): Promise<BranchStockRow[]> {
  const scope = await getCurrentScope()
  if (!scope || !scope.branchId) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("product_stock")
    .select("product_id, quantity, products(name, sku)")
    .eq("branch_id", scope.branchId)
    .eq("organisation_id", scope.organisationId)

  if (error || !data) return []

  type Raw = {
    product_id: string
    quantity: number
    products: { name: string; sku: string | null } | null
  }

  return (data as Raw[])
    .filter((r) => r.products != null)
    .map((r) => ({
      productId: r.product_id,
      name: r.products!.name,
      sku: r.products!.sku,
      quantity: r.quantity,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
