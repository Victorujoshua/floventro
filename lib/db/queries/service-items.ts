import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export type Measurement = {
  id: string
  organisationId: string | null
  name: string
  symbol: string | null
  isSystem: boolean
  createdAt: string
}

export type ServiceItem = {
  id: string
  name: string
  category: "product" | "supply" | "equipment"
  measurementId: string | null
  measurementName: string | null
  measurementSymbol: string | null
  packageSize: number | null
  amountCents: number
  productId: string | null
  productName: string | null
  productSku: string | null
  isActive: boolean
  createdAt: string
}

export async function getMeasurements(): Promise<Measurement[]> {
  const scope = await getCurrentScope()
  if (!scope) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const { data, error } = await supabase
    .from("measurements")
    .select("id, organisation_id, name, symbol, is_system, created_at")
    .or(`organisation_id.is.null,organisation_id.eq.${scope.organisationId}`)
    .order("is_system", { ascending: false })
    .order("name",      { ascending: true })

  if (error) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id:             r.id,
    organisationId: r.organisation_id,
    name:           r.name,
    symbol:         r.symbol,
    isSystem:       r.is_system,
    createdAt:      r.created_at,
  }))
}

export async function getServiceItems(): Promise<ServiceItem[]> {
  const scope = await getCurrentScope()
  if (!scope) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const { data, error } = await supabase
    .from("service_items")
    .select(`
      id, name, category, measurement_id, package_size,
      amount_cents, product_id, is_active, created_at,
      measurements ( name, symbol ),
      products     ( name, sku )
    `)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id:                r.id,
    name:              r.name,
    category:          r.category,
    measurementId:     r.measurement_id,
    measurementName:   r.measurements?.name  ?? null,
    measurementSymbol: r.measurements?.symbol ?? null,
    packageSize:       r.package_size != null ? Number(r.package_size) : null,
    amountCents:       r.amount_cents,
    productId:         r.product_id,
    productName:       r.products?.name ?? null,
    productSku:        r.products?.sku  ?? null,
    isActive:          r.is_active,
    createdAt:         r.created_at,
  }))
}
