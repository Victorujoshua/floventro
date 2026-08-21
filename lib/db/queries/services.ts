import "server-only"
import { createAppServerClient, createAppServiceRoleClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

// ── Public types ──────────────────────────────────────────────────────────────

export type ServiceType = {
  id: string
  name: string
  description: string | null
  defaultPriceCents: number
  isActive: boolean
  createdAt: string
}

export type ServiceRecordRow = {
  id: string
  performedOn: string
  serviceTypeName: string
  performedByUserId: string
  performedByLabel: string
  customerName: string | null
  memberId: string | null
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
  clientEmail: string | null
  note: string | null
  clientPlanId: string | null
  sessionRevenueCents: number | null
  totalCogsCents: number | null
  costFullyKnown: boolean
  lines: ServiceConsumptionLine[]
}

export type JobCostingSessionRow = {
  id: string
  performedOn: string
  serviceTypeName: string
  customerName: string | null
  sessionRevenueCents: number
  totalCogsCents: number | null
  costFullyKnown: boolean
}

// ── Raw shapes returned by Supabase ──────────────────────────────────────────

type RawServiceType = {
  id: string
  name: string
  description: string | null
  default_price_cents: number
  is_active: boolean
  created_at: string
}

type RawServiceRecord = {
  id: string
  performed_on: string
  performed_by: string
  customer_name: string | null
  member_id: string | null
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
  member_id: string | null
  client_email: string | null
  service_fee_cents: number | null
  note: string | null
  created_at: string
  client_plan_id: string | null
  session_revenue_cents: number | null
  service_types: { name: string } | { name: string }[] | null
  service_consumption: RawServiceConsumption[]
}

type RawCogsRow = {
  reference_id: string
  cogs_cents: number | null
  cost_known: boolean
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
    .select("id, name, description, default_price_cents, is_active, created_at")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error || !data) return []

  return (data as RawServiceType[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    defaultPriceCents: row.default_price_cents,
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
    .select("id, name, description, default_price_cents, is_active, created_at")
    .eq("organisation_id", scope.organisationId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error || !data) return []

  return (data as RawServiceType[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    defaultPriceCents: row.default_price_cents,
    isActive: row.is_active,
    createdAt: row.created_at,
  }))
}

export async function getServiceRecords(): Promise<ServiceRecordRow[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  let query = supabase
    .from("service_records")
    .select(
      "id, performed_on, performed_by, customer_name, member_id, service_fee_cents, created_at, service_types(name), service_consumption(count)",
    )
    .eq("organisation_id", scope.organisationId)
    .order("created_at", { ascending: false })
    .limit(100)

  if (scope.branchId) {
    query = query.eq("branch_id", scope.branchId)
  }

  const { data, error } = await query

  if (error || !data) return []

  const rows = data as RawServiceRecord[]
  const performerIds = [...new Set(rows.map((r) => r.performed_by))]
  const performerMap = await fetchPerformerMap(performerIds)

  return rows.map((row) => ({
    id: row.id,
    performedOn: row.performed_on,
    serviceTypeName: resolveServiceTypeName(row.service_types),
    performedByUserId: row.performed_by,
    performedByLabel: performerMap.get(row.performed_by) ?? row.performed_by,
    customerName: row.customer_name,
    memberId: row.member_id,
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
      "id, performed_on, performed_by, customer_name, customer_phone, member_id, client_email, service_fee_cents, note, created_at, client_plan_id, session_revenue_cents, service_types(name), service_consumption(id, product_id, quantity, products(name, sku))",
    )
    .eq("id", id)
    .eq("organisation_id", scope.organisationId)
    .maybeSingle()

  if (error || !data) return null

  const row = data as RawServiceRecordDetail
  const performerMap = await fetchPerformerMap([row.performed_by])

  // Fetch COGS for each consumption line
  const consumptionIds = row.service_consumption.map((c) => c.id)
  let totalCogsCents: number | null = null
  let costFullyKnown = false

  if (consumptionIds.length > 0) {
    const { data: cogsRows } = await supabase
      .from("cogs_allocations")
      .select("reference_id, cogs_cents, cost_known")
      .eq("reference_type", "service_consumption")
      .in("reference_id", consumptionIds)

    const cogsMap = new Map<string, RawCogsRow>()
    for (const g of (cogsRows ?? []) as RawCogsRow[]) {
      cogsMap.set(g.reference_id, g)
    }

    const allKnown = consumptionIds.every((cid) => cogsMap.get(cid)?.cost_known === true)
    costFullyKnown = allKnown
    totalCogsCents = allKnown
      ? consumptionIds.reduce((sum, cid) => sum + (cogsMap.get(cid)?.cogs_cents ?? 0), 0)
      : null
  }

  return {
    id: row.id,
    performedOn: row.performed_on,
    serviceTypeName: resolveServiceTypeName(row.service_types),
    performedByUserId: row.performed_by,
    performedByLabel: performerMap.get(row.performed_by) ?? row.performed_by,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    memberId: row.member_id,
    clientEmail: row.client_email,
    serviceFeeCents: row.service_fee_cents,
    note: row.note,
    consumptionCount: row.service_consumption.length,
    createdAt: row.created_at,
    clientPlanId: row.client_plan_id,
    sessionRevenueCents: row.session_revenue_cents,
    totalCogsCents,
    costFullyKnown,
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

export async function getMyJobCostingSessions(): Promise<JobCostingSessionRow[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return []

  // 1. Plan-linked records for this user
  const { data: records, error } = await supabase
    .from("service_records")
    .select(
      "id, performed_on, session_revenue_cents, customer_name, service_types(name), service_consumption(id)",
    )
    .eq("organisation_id", scope.organisationId)
    .eq("performed_by", authData.user.id)
    .not("session_revenue_cents", "is", null)
    .order("performed_on", { ascending: false })
    .limit(100)

  if (error || !records || records.length === 0) return []

  // 2. Batch collect all consumption IDs
  const allConsumptionIds = (records as { service_consumption: { id: string }[] }[]).flatMap(
    (r) => r.service_consumption.map((c) => c.id),
  )

  // 3. Batch fetch COGS
  const cogsMap = new Map<string, RawCogsRow>()
  if (allConsumptionIds.length > 0) {
    const { data: cogsRows } = await supabase
      .from("cogs_allocations")
      .select("reference_id, cogs_cents, cost_known")
      .eq("reference_type", "service_consumption")
      .in("reference_id", allConsumptionIds)

    for (const g of (cogsRows ?? []) as RawCogsRow[]) {
      cogsMap.set(g.reference_id, g)
    }
  }

  // 4. Join in TypeScript
  return (
    records as {
      id: string
      performed_on: string
      session_revenue_cents: number
      customer_name: string | null
      service_types: { name: string } | { name: string }[] | null
      service_consumption: { id: string }[]
    }[]
  ).map((r) => {
    const consumptionIds = r.service_consumption.map((c) => c.id)
    const allKnown =
      consumptionIds.length > 0 &&
      consumptionIds.every((cid) => cogsMap.get(cid)?.cost_known === true)
    const totalCogsCents = allKnown
      ? consumptionIds.reduce((sum, cid) => sum + (cogsMap.get(cid)?.cogs_cents ?? 0), 0)
      : null

    return {
      id: r.id,
      performedOn: r.performed_on,
      serviceTypeName: resolveServiceTypeName(r.service_types),
      customerName: r.customer_name,
      sessionRevenueCents: r.session_revenue_cents,
      totalCogsCents,
      costFullyKnown: allKnown,
    }
  })
}
