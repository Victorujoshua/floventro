import "server-only"
import { createAppServerClient, createAppServiceRoleClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

// ── Raw DB shapes ─────────────────────────────────────────────────────────────

type RawProduct = { id: string; sku: string; name: string }

type RawLine = {
  id: string
  product_id: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
  products: RawProduct | RawProduct[] | null
}

type RawOrder = {
  id: string
  organisation_id: string
  branch_id: string
  status: string
  distributor_name: string
  distributor_phone: string | null
  distributor_email: string | null
  total_cents: number
  payment_method: string | null
  payment_status: string
  amount_paid_cents: number
  note: string | null
  requested_by: string
  packed_by: string | null
  shipped_by: string | null
  delivered_by: string | null
  cancelled_by: string | null
  packed_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  fulfilment_lines: RawLine[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveProduct(raw: RawProduct | RawProduct[] | null): RawProduct | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

async function fetchUserLabels(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const admin = createAppServiceRoleClient()
  const map = new Map<string, string>()
  await Promise.all(
    userIds.map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid)
      const user = data.user
      map.set(uid, (user?.user_metadata?.full_name as string) || user?.email || uid)
    }),
  )
  return map
}

// ── Public types ──────────────────────────────────────────────────────────────

export type FulfilmentStatus = "pending" | "packed" | "shipped" | "delivered" | "cancelled"

export type FulfilmentOrderLine = {
  id: string
  productId: string
  productSku: string
  productName: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}

export type FulfilmentOrder = {
  id: string
  branchId: string
  status: FulfilmentStatus
  distributorName: string
  distributorPhone: string | null
  distributorEmail: string | null
  totalCents: number
  paymentMethod: string | null
  paymentStatus: string
  amountPaidCents: number
  note: string | null
  requestedByLabel: string
  packedByLabel: string | null
  shippedByLabel: string | null
  deliveredByLabel: string | null
  cancelledByLabel: string | null
  packedAt: string | null
  shippedAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  createdAt: string
  lines: FulfilmentOrderLine[]
}

// ── Queries ───────────────────────────────────────────────────────────────────

const ORDER_SELECT =
  "id, organisation_id, branch_id, status, distributor_name, distributor_phone, distributor_email, total_cents, payment_method, payment_status, amount_paid_cents, note, requested_by, packed_by, shipped_by, delivered_by, cancelled_by, packed_at, shipped_at, delivered_at, cancelled_at, created_at, updated_at, fulfilment_lines(id, product_id, quantity, unit_price_cents, line_total_cents, products(id, sku, name))"

function mapOrder(o: RawOrder, userMap: Map<string, string>): FulfilmentOrder {
  return {
    id: o.id,
    branchId: o.branch_id,
    status: o.status as FulfilmentStatus,
    distributorName: o.distributor_name,
    distributorPhone: o.distributor_phone,
    distributorEmail: o.distributor_email,
    totalCents: o.total_cents,
    paymentMethod: o.payment_method,
    paymentStatus: o.payment_status,
    amountPaidCents: o.amount_paid_cents,
    note: o.note,
    requestedByLabel:  userMap.get(o.requested_by)  ?? o.requested_by,
    packedByLabel:     o.packed_by    ? (userMap.get(o.packed_by)    ?? o.packed_by)    : null,
    shippedByLabel:    o.shipped_by   ? (userMap.get(o.shipped_by)   ?? o.shipped_by)   : null,
    deliveredByLabel:  o.delivered_by ? (userMap.get(o.delivered_by) ?? o.delivered_by) : null,
    cancelledByLabel:  o.cancelled_by ? (userMap.get(o.cancelled_by) ?? o.cancelled_by) : null,
    packedAt:    o.packed_at,
    shippedAt:   o.shipped_at,
    deliveredAt: o.delivered_at,
    cancelledAt: o.cancelled_at,
    createdAt:   o.created_at,
    lines: (o.fulfilment_lines ?? []).map((l) => {
      const prod = resolveProduct(l.products)
      return {
        id: l.id,
        productId: l.product_id,
        productSku: prod?.sku ?? "",
        productName: prod?.name ?? "Unknown product",
        quantity: l.quantity,
        unitPriceCents: l.unit_price_cents,
        lineTotalCents: l.line_total_cents,
      }
    }),
  }
}

export async function getFulfilmentOrders(limit = 100): Promise<FulfilmentOrder[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  let query = supabase
    .from("fulfilment_orders")
    .select(ORDER_SELECT)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (scope.branchId) {
    query = query.eq("branch_id", scope.branchId)
  }

  const { data, error } = await query
  if (error || !data) return []

  const orders = data as RawOrder[]
  const allUids = [...new Set([
    ...orders.map((o) => o.requested_by),
    ...(orders.map((o) => o.packed_by).filter(Boolean)    as string[]),
    ...(orders.map((o) => o.shipped_by).filter(Boolean)   as string[]),
    ...(orders.map((o) => o.delivered_by).filter(Boolean) as string[]),
    ...(orders.map((o) => o.cancelled_by).filter(Boolean) as string[]),
  ])]
  const userMap = await fetchUserLabels(allUids)

  return orders.map((o) => mapOrder(o, userMap))
}

export async function getFulfilmentOrderById(id: string): Promise<FulfilmentOrder | null> {
  const scope = await getCurrentScope()
  if (!scope) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("fulfilment_orders")
    .select(ORDER_SELECT)
    .eq("id", id)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .maybeSingle()

  if (error || !data) return null

  const o = data as RawOrder
  const allUids = [
    o.requested_by, o.packed_by, o.shipped_by, o.delivered_by, o.cancelled_by,
  ].filter(Boolean) as string[]
  const userMap = await fetchUserLabels(allUids)

  return mapOrder(o, userMap)
}
