import "server-only"
import { createAppServerClient, createAppServiceRoleClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

// ── Public types ──────────────────────────────────────────────────────────────

export type ServiceType = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: string
}

export type ServiceRecordRow = {
  id: string
  performedOn: string
  serviceTypeName: string
  performedByLabel: string
  customerName: string | null
  serviceFeeCents: number | null
  consumptionCount: number
  createdAt: string
}

export type ServiceConsumptionLine = {
  id: string
  productId: string
  productName: string
  productSku: string
  quantity: number
}

export type ServiceRecordDetail = ServiceRecordRow & {
  customerPhone: string | null
  note: string | null
  lines: ServiceConsumptionLine[]
}

// ── Raw shapes returned by Supabase ──────────────────────────────────────────

type RawServiceType = {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
}

type RawServiceRecord = {
  id: string
  performed_on: string
  performed_by: string
  customer_name: string | null
  service_fee_cents: number | null
  created_at: string
  service_types: { name: string } | { name: string }[] | null
  service_consumption: { count: number }[]
}

type RawServiceConsumption = {
  id: string
  product_id: string
  quantity: number
  products: { name: string; sku: string } | { name: string; sku: string }[] | null
}

type RawServiceRecordDetail = {
  id: string
  performed_on: string
  performed_by: string
  customer_name: string | null
  customer_phone: string | null
  service_fee_cents: number | null
  note: string | null
  created_at: string
  service_types: { name: string } | { name: string }[] | null
  service_consumption: RawServiceConsumption[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveServiceTypeName(raw: { name: string } | { name: string }[] | null): string {
  if (!raw) return "Unknown service"
  if (Array.isArray(raw)) return raw[0]?.name ?? "Unknown service"
  return raw.name
}

function resolveProduct(
  raw: RawServiceConsumption["products"],
): { name: string; sku: string } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

async function fetchPerformerMap(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (ids.length === 0) return map
  const admin = createAppServiceRoleClient()
  await Promise.all(
    ids.map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid)
      const name =
        (data.user?.user_metadata?.full_name as string) || data.user?.email || uid
      map.set(uid, name)
    }),
  )
  return map
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getServiceTypes(): Promise<ServiceType[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("service_types")
    .select("id, name, description, is_active, created_at")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error || !data) return []

  return (data as RawServiceType[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
  }))
}

export async function getActiveServiceTypes(): Promise<ServiceType[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("service_types")
    .select("id, name, description, is_active, created_at")
    .eq("organisation_id", scope.organisationId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error || !data) return []

  return (data as RawServiceType[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
  }))
}

export async function getServiceRecords(): Promise<ServiceRecordRow[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("service_records")
    .select(
      "id, performed_on, performed_by, customer_name, service_fee_cents, created_at, service_types(name), service_consumption(count)",
    )
    .order("created_at", { ascending: false })
    .limit(100)

  if (error || !data) return []

  const rows = data as RawServiceRecord[]
  const performerIds = [...new Set(rows.map((r) => r.performed_by))]
  const performerMap = await fetchPerformerMap(performerIds)

  return rows.map((row) => ({
    id: row.id,
    performedOn: row.performed_on,
    serviceTypeName: resolveServiceTypeName(row.service_types),
    performedByLabel: performerMap.get(row.performed_by) ?? row.performed_by,
    customerName: row.customer_name,
    serviceFeeCents: row.service_fee_cents,
    consumptionCount:
      (row.service_consumption as unknown as { count: number }[])?.[0]?.count ?? 0,
    createdAt: row.created_at,
  }))
}

export async function getServiceRecordById(id: string): Promise<ServiceRecordDetail | null> {
  const scope = await getCurrentScope()
  if (!scope) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("service_records")
    .select(
      "id, performed_on, performed_by, customer_name, customer_phone, service_fee_cents, note, created_at, service_types(name), service_consumption(id, product_id, quantity, products(name, sku))",
    )
    .eq("id", id)
    .single()

  if (error || !data) return null

  const row = data as RawServiceRecordDetail
  const performerMap = await fetchPerformerMap([row.performed_by])

  return {
    id: row.id,
    performedOn: row.performed_on,
    serviceTypeName: resolveServiceTypeName(row.service_types),
    performedByLabel: performerMap.get(row.performed_by) ?? row.performed_by,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    serviceFeeCents: row.service_fee_cents,
    note: row.note,
    consumptionCount: row.service_consumption.length,
    createdAt: row.created_at,
    lines: row.service_consumption.map((c) => {
      const product = resolveProduct(c.products)
      return {
        id: c.id,
        productId: c.product_id,
        productName: product?.name ?? "Unknown product",
        productSku: product?.sku ?? "",
        quantity: c.quantity,
      }
    }),
  }
}
