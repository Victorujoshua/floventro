import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"
import { getProducts } from "./products"

export { getProducts as getProductsForOrg }

export async function getVendorsForBranch(branchId: string) {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("branch_id", branchId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error) return []
  return data
}

export async function getInvoices() {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  let query = supabase
    .from("vendor_invoices")
    .select(
      "id, invoice_number, invoice_date, due_date, subtotal_cents, vat_rate, vat_cents, total_cents, amount_paid_cents, credited_subtotal_cents, credited_cents, status, receipt_status, created_at, vendors(name)",
    )
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("invoice_date", { ascending: false })

  if (scope.branchId) {
    query = query.eq("branch_id", scope.branchId)
  }

  const { data, error } = await query
  if (error) return []
  return data
}

export type InvoiceLineForReceiving = {
  id: string
  productName: string
  productSku: string
  quantity: number
  quantityReceived: number
  // 0 once the line is closed short — nothing more can be received
  remaining: number
  unitCostCents: number
  closedShort: boolean
  // Undelivered quantity written off when the line was closed short
  closedShortQuantity: number
}

export type InvoiceForReceiving = {
  id: string
  invoiceNumber: string | null
  vendorName: string
  receiptStatus: string
  vatRate: number | null
  creditedSubtotalCents: number
  // total − credited − paid: the most a new vendor credit may be
  outstandingCents: number
  lines: InvoiceLineForReceiving[]
}

export async function getInvoiceForReceiving(id: string): Promise<InvoiceForReceiving | null> {
  const scope = await getCurrentScope()
  if (!scope) return null

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("vendor_invoices")
    .select(
      "id, invoice_number, receipt_status, vat_rate, total_cents, amount_paid_cents, credited_subtotal_cents, credited_cents, vendors(name), vendor_invoice_lines(id, quantity, quantity_received, unit_cost_cents, closed_short_at, products(name, sku))",
    )
    .eq("id", id)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .maybeSingle()

  if (error || !data) return null

  type RawProduct = { name: string; sku: string }
  type RawLine = {
    id: string
    quantity: number
    quantity_received: number | null
    unit_cost_cents: number
    closed_short_at: string | null
    products: RawProduct | RawProduct[] | null
  }
  type RawData = {
    id: string
    invoice_number: string | null
    receipt_status: string
    vat_rate: number | null
    total_cents: number
    amount_paid_cents: number
    credited_subtotal_cents: number
    credited_cents: number
    vendors: { name: string } | { name: string }[] | null
    vendor_invoice_lines: RawLine[]
  }

  const raw = data as unknown as RawData
  const vendorName = Array.isArray(raw.vendors)
    ? (raw.vendors[0] as RawProduct | undefined)?.name
    : (raw.vendors as { name: string } | null)?.name

  const lines: InvoiceLineForReceiving[] = (raw.vendor_invoice_lines ?? []).map((l) => {
    const prod = Array.isArray(l.products) ? l.products[0] : (l.products as RawProduct | null)
    const received = l.quantity_received ?? 0
    const closedShort = l.closed_short_at !== null
    return {
      id: l.id,
      productName: prod?.name ?? "Unknown product",
      productSku: prod?.sku ?? "",
      quantity: l.quantity,
      quantityReceived: received,
      remaining: closedShort ? 0 : l.quantity - received,
      unitCostCents: l.unit_cost_cents,
      closedShort,
      closedShortQuantity: closedShort ? l.quantity - received : 0,
    }
  })

  return {
    id: raw.id,
    invoiceNumber: raw.invoice_number,
    vendorName: vendorName ?? "Unknown vendor",
    receiptStatus: raw.receipt_status,
    vatRate: raw.vat_rate,
    creditedSubtotalCents: raw.credited_subtotal_cents,
    outstandingCents: raw.total_cents - raw.credited_cents - raw.amount_paid_cents,
    lines,
  }
}
