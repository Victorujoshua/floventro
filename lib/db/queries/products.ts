import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export async function getProducts() {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, sku, name, description, reorder_point, unit_cost_cents, created_at, updated_at, product_stock(quantity)",
    )
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error) return []

  // Sum product_stock quantities across all branches (correct for owner who spans all;
  // for inventory members, RLS already filters to their branch only).
  return data.map(({ product_stock, ...p }) => ({
    ...p,
    stock: (product_stock as { quantity: number }[] ?? []).reduce(
      (sum, s) => sum + s.quantity,
      0,
    ),
  }))
}
