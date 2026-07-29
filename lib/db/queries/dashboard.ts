import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"
import { formatNaira } from "@/lib/format/money"
import { getPendingRequestCount } from "./requests"

export async function getStockSummary() {
  const scope = await getCurrentScope()
  if (!scope) return { totalUnits: 0, productsWithStock: 0, lowStockCount: 0 }

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("products")
    .select("reorder_point, product_stock(branch_id, quantity)")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)

  if (error || !data) return { totalUnits: 0, productsWithStock: 0, lowStockCount: 0 }

  let totalUnits = 0
  let productsWithStock = 0
  let lowStockCount = 0

  const branchId = scope.branchId
  for (const product of data) {
    const qty = (product.product_stock as { branch_id: string; quantity: number }[] ?? [])
      .filter((s) => !branchId || s.branch_id === branchId)
      .reduce((sum, s) => sum + s.quantity, 0)
    totalUnits += qty
    if (qty > 0) productsWithStock++
    if (product.reorder_point > 0 && qty <= product.reorder_point) lowStockCount++
  }

  return { totalUnits, productsWithStock, lowStockCount }
}

export async function getPayablesSummary() {
  const scope = await getCurrentScope()
  if (!scope) return { outstandingCents: 0, unpaidCount: 0, pastDueCount: 0 }

  const supabase = await createAppServerClient()

  const today = new Date().toISOString().split("T")[0]

  let payablesQuery = supabase
    .from("vendor_invoices")
    .select("total_cents, amount_paid_cents, status, due_date")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .in("status", ["unpaid", "partial"])

  if (scope.branchId) {
    payablesQuery = payablesQuery.eq("branch_id", scope.branchId)
  }

  const { data, error } = await payablesQuery

  if (error || !data) return { outstandingCents: 0, unpaidCount: 0, pastDueCount: 0 }

  let outstandingCents = 0
  let pastDueCount = 0

  for (const inv of data) {
    outstandingCents += inv.total_cents - inv.amount_paid_cents
    if (inv.due_date && inv.due_date < today) pastDueCount++
  }

  return { outstandingCents, unpaidCount: data.length, pastDueCount }
}

export async function getRecentInvoices(limit = 5) {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  let recentQuery = supabase
    .from("vendor_invoices")
    .select("id, invoice_number, invoice_date, total_cents, status, vendors(name)")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("invoice_date", { ascending: false })
    .limit(limit)

  if (scope.branchId) {
    recentQuery = recentQuery.eq("branch_id", scope.branchId)
  }

  const { data, error } = await recentQuery

  if (error) return []
  return data
}

export async function getStockReceivedSeries() {
  const scope = await getCurrentScope()
  if (!scope) return [] as { date: string; units: number }[]

  const supabase = await createAppServerClient()

  // Build 30-day date list (oldest first)
  const today = new Date()
  const dates: string[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split("T")[0])
  }
  const since = dates[0] + "T00:00:00.000Z"

  let ledgerQuery = supabase
    .from("stock_ledger")
    .select("quantity_delta, created_at")
    .eq("organisation_id", scope.organisationId)
    .eq("reason", "vendor_invoice")
    .gt("quantity_delta", 0)
    .gte("created_at", since)

  if (scope.branchId) {
    ledgerQuery = ledgerQuery.eq("branch_id", scope.branchId)
  }

  const { data, error } = await ledgerQuery

  if (error || !data) return dates.map((date) => ({ date, units: 0 }))

  const byDate = new Map<string, number>()
  for (const row of data) {
    const date = (row.created_at as string).split("T")[0]
    byDate.set(date, (byDate.get(date) ?? 0) + (row.quantity_delta as number))
  }

  return dates.map((date) => ({ date, units: byDate.get(date) ?? 0 }))
}

export type NotificationItem = {
  id: string
  kind: "past_due" | "low_stock" | "pending_requests"
  title: string
  detail: string
  href?: string
}

export async function getNotifications(): Promise<NotificationItem[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()
  const today = new Date().toISOString().split("T")[0]

  let notifInvoiceQuery = supabase
    .from("vendor_invoices")
    .select("id, invoice_number, total_cents, due_date, vendors(name)")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .in("status", ["unpaid", "partial"])
    .lt("due_date", today)
    .order("due_date", { ascending: true })
    .limit(10)

  if (scope.branchId) {
    notifInvoiceQuery = notifInvoiceQuery.eq("branch_id", scope.branchId)
  }

  const [invoiceRes, productRes, pendingCount] = await Promise.all([
    notifInvoiceQuery,
    supabase
      .from("products")
      .select("id, sku, name, reorder_point, product_stock(branch_id, quantity)")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)
      .gt("reorder_point", 0),
    getPendingRequestCount(),
  ])

  const items: NotificationItem[] = []

  for (const inv of invoiceRes.data ?? []) {
    if (!inv.due_date) continue
    const daysOverdue = Math.floor(
      (Date.now() - new Date(inv.due_date + "T00:00:00").getTime()) / 86_400_000,
    )
    const vName = Array.isArray(inv.vendors)
      ? (inv.vendors[0] as { name?: string })?.name
      : (inv.vendors as { name?: string } | null)?.name
    items.push({
      id: inv.id,
      kind: "past_due",
      title: `${inv.invoice_number ?? "Invoice"} to ${vName ?? "vendor"}`,
      detail: `₦${formatNaira(inv.total_cents)} · ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue`,
    })
  }

  const branchId = scope.branchId
  for (const p of productRes.data ?? []) {
    const qty = (p.product_stock as { branch_id: string; quantity: number }[] ?? [])
      .filter((s) => !branchId || s.branch_id === branchId)
      .reduce((s, r) => s + r.quantity, 0)
    if (qty > p.reorder_point) continue
    items.push({
      id: p.id,
      kind: "low_stock",
      title: p.sku ?? p.name,
      detail: `${qty} / ${p.reorder_point} units`,
    })
  }

  if (pendingCount > 0) {
    items.push({
      id: "pending-requests",
      kind: "pending_requests",
      title: `${pendingCount} stock request${pendingCount !== 1 ? "s" : ""} awaiting review`,
      detail: "Tap to review",
      href: "/inventory/requests",
    })
  }

  return items
}

// ── Personal dashboard queries (sales / internal_use only) ──────────────────

export async function getPersonalHoldingSummary() {
  const scope = await getCurrentScope()
  if (!scope) return { totalUnits: 0, productCount: 0 }

  const supabase = await createAppServerClient()
  const { data: authData } = await supabase.auth.getUser()
  if (!authData?.user) return { totalUnits: 0, productCount: 0 }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("staff_holdings")
    .select("quantity")
    .eq("holder_user_id", authData.user.id)
    .eq("organisation_id", scope.organisationId)
    .gt("quantity", 0)

  if (error || !data) return { totalUnits: 0, productCount: 0 }

  return {
    totalUnits: (data as { quantity: number }[]).reduce((sum, h) => sum + h.quantity, 0),
    productCount: (data as unknown[]).length,
  }
}

export async function getMyRecentSales(limit = 5) {
  const scope = await getCurrentScope()
  if (!scope) return [] as { id: string; sold_on: string; customer_name: string | null; total_cents: number; payment_status: string }[]

  const supabase = await createAppServerClient()
  const { data: authData } = await supabase.auth.getUser()
  if (!authData?.user) return []

  let query = supabase
    .from("sales")
    .select("id, sold_on, customer_name, total_cents, payment_status")
    .eq("seller_user_id", authData.user.id)
    .eq("organisation_id", scope.organisationId)
    .order("sold_on", { ascending: false })
    .limit(limit)

  if (scope.branchId) {
    query = query.eq("branch_id", scope.branchId)
  }

  const { data, error } = await query
  if (error || !data) return []
  return data as { id: string; sold_on: string; customer_name: string | null; total_cents: number; payment_status: string }[]
}

export async function getMyPendingRequestCount() {
  const scope = await getCurrentScope()
  if (!scope) return 0

  const supabase = await createAppServerClient()
  const { data: authData } = await supabase.auth.getUser()
  if (!authData?.user) return 0

  let query = supabase
    .from("stock_requests")
    .select("id", { count: "exact", head: true })
    .eq("requested_by", authData.user.id)
    .eq("organisation_id", scope.organisationId)
    .eq("status", "pending")

  if (scope.branchId) {
    query = query.eq("branch_id", scope.branchId)
  }

  const { count, error } = await query
  if (error) return 0
  return count ?? 0
}

export async function getLowStockProducts(limit = 5) {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("products")
    .select("id, sku, name, reorder_point, product_stock(branch_id, quantity)")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .gt("reorder_point", 0)

  if (error || !data) return []

  const branchId = scope.branchId
  return data
    .map(({ product_stock, ...p }) => ({
      ...p,
      quantity: (product_stock as { branch_id: string; quantity: number }[] ?? [])
        .filter((s) => !branchId || s.branch_id === branchId)
        .reduce((sum, s) => sum + s.quantity, 0),
    }))
    .filter((p) => p.quantity <= p.reorder_point)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, limit)
}
