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
    .select("reorder_point, product_stock(quantity)")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)

  if (error || !data) return { totalUnits: 0, productsWithStock: 0, lowStockCount: 0 }

  let totalUnits = 0
  let productsWithStock = 0
  let lowStockCount = 0

  for (const product of data) {
    const qty = (product.product_stock as { quantity: number }[] ?? []).reduce(
      (sum, s) => sum + s.quantity,
      0,
    )
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

  const { data, error } = await supabase
    .from("vendor_invoices")
    .select("total_cents, amount_paid_cents, status, due_date")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .in("status", ["unpaid", "partial"])

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

  const { data, error } = await supabase
    .from("vendor_invoices")
    .select("id, invoice_number, invoice_date, total_cents, status, vendors(name)")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("invoice_date", { ascending: false })
    .limit(limit)

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

  const { data, error } = await supabase
    .from("stock_ledger")
    .select("quantity_delta, created_at")
    .eq("reason", "vendor_invoice")
    .gt("quantity_delta", 0)
    .gte("created_at", since)

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

  const [invoiceRes, productRes, pendingCount] = await Promise.all([
    supabase
      .from("vendor_invoices")
      .select("id, invoice_number, total_cents, due_date, vendors(name)")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)
      .in("status", ["unpaid", "partial"])
      .lt("due_date", today)
      .order("due_date", { ascending: true })
      .limit(10),
    supabase
      .from("products")
      .select("id, sku, name, reorder_point, product_stock(quantity)")
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

  for (const p of productRes.data ?? []) {
    const qty = (p.product_stock as { quantity: number }[] ?? []).reduce(
      (s, r) => s + r.quantity,
      0,
    )
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

export async function getLowStockProducts(limit = 5) {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("products")
    .select("id, sku, name, reorder_point, product_stock(quantity)")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .gt("reorder_point", 0)

  if (error || !data) return []

  return data
    .map(({ product_stock, ...p }) => ({
      ...p,
      quantity: (product_stock as { quantity: number }[] ?? []).reduce(
        (sum, s) => sum + s.quantity,
        0,
      ),
    }))
    .filter((p) => p.quantity <= p.reorder_point)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, limit)
}
