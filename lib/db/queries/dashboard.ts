import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

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
