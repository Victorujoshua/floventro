"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"

export type InvoiceExportRow = {
  invoiceNumber: string
  vendor: string
  invoiceDate: string
  dueDate: string
  status: string
  receiptStatus: string
  invoiceTotalNaira: number
  productName: string
  productSku: string
  quantity: number
  unitCostNaira: number
  lineTotalNaira: number
}

export async function fetchInvoiceExportRowsAction(): Promise<InvoiceExportRow[]> {
  const scope = await requireRole("owner", "inventory", "admin")
  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("vendor_invoices")
    .select(`
      invoice_number,
      invoice_date,
      due_date,
      status,
      receipt_status,
      total_cents,
      vendors ( name ),
      vendor_invoice_lines (
        quantity,
        unit_cost_cents,
        products ( name, sku )
      )
    `)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("invoice_date", { ascending: false })

  if (error || !data) return []

  const rows: InvoiceExportRow[] = []

  for (const inv of data) {
    const vendor = (inv.vendors as unknown as { name: string } | null)?.name ?? ""
    const lines = (inv.vendor_invoice_lines ?? []) as unknown as Array<{
      quantity: number
      unit_cost_cents: number
      products: { name: string; sku: string } | null
    }>

    for (const line of lines) {
      rows.push({
        invoiceNumber: inv.invoice_number ?? "",
        vendor,
        invoiceDate: inv.invoice_date ?? "",
        dueDate: inv.due_date ?? "",
        status: inv.status ?? "",
        receiptStatus: inv.receipt_status ?? "",
        invoiceTotalNaira: (inv.total_cents ?? 0) / 100,
        productName: line.products?.name ?? "",
        productSku: line.products?.sku ?? "",
        quantity: line.quantity ?? 0,
        unitCostNaira: (line.unit_cost_cents ?? 0) / 100,
        lineTotalNaira: ((line.quantity ?? 0) * (line.unit_cost_cents ?? 0)) / 100,
      })
    }
  }

  return rows
}
