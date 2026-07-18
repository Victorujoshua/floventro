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

  const { data, error } = await supabase
    .from("vendor_invoices")
    .select(
      "id, invoice_number, invoice_date, due_date, total_cents, amount_paid_cents, status, receipt_status, created_at, vendors(name)",
    )
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("invoice_date", { ascending: false })

  if (error) return []
  return data
}

export type InvoiceLineForReceiving = {
  id: string
  productName: string
  productSku: string
  quantity: number
  quantityReceived: number
  remaining: number
}

export type InvoiceForReceiving = {
  id: string
  invoiceNumber: string | null
  vendorName: string
  receiptStatus: string
  lines: InvoiceLineForReceiving[]
}

export async function getInvoiceForReceiving(id: string): Promise<InvoiceForReceiving | null> {
  const scope = await getCurrentScope()
  if (!scope) return null

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("vendor_invoices")
    .select(
      "id, invoice_number, receipt_status, vendors(name), vendor_invoice_lines(id, quantity, quantity_received, products(name, sku))",
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
    products: RawProduct | RawProduct[] | null
  }
  type RawData = {
    id: string
    invoice_number: string | null
    receipt_status: string
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
    return {
      id: l.id,
      productName: prod?.name ?? "Unknown product",
      productSku: prod?.sku ?? "",
      quantity: l.quantity,
      quantityReceived: received,
      remaining: l.quantity - received,
    }
  })

  return {
    id: raw.id,
    invoiceNumber: raw.invoice_number,
    vendorName: vendorName ?? "Unknown vendor",
    receiptStatus: raw.receipt_status,
    lines,
  }
}
