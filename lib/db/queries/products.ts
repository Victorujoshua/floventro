import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export async function getProducts() {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, sku, name, description, reorder_point, unit_cost_cents, default_price_cents, created_at, updated_at, product_stock(quantity)",
    )
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error) return []

  type RawProduct = {
    product_stock: { quantity: number }[]
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

  // Sum product_stock quantities across all branches (correct for owner who spans all;
  // for inventory members, RLS already filters to their branch only).
  return (data as RawProduct[]).map(({ product_stock, ...p }) => ({
    ...p,
    stock: (product_stock ?? []).reduce((sum: number, s: { quantity: number }) => sum + s.quantity, 0),
  }))
}
