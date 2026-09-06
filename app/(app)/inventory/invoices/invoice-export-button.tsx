"use client"

import { ExportButton } from "@/components/app/export-button"
import { fetchInvoiceExportRowsAction } from "@/lib/db/actions/export"
import type { ExportColumn } from "@/lib/export/xlsx"

const COLUMNS: ExportColumn[] = [
  { header: "invoice_number",      key: "invoiceNumber" },
  { header: "vendor",              key: "vendor" },
  { header: "invoice_date",        key: "invoiceDate" },
  { header: "due_date",            key: "dueDate" },
  { header: "status",              key: "status" },
  { header: "receipt_status",      key: "receiptStatus" },
  { header: "invoice_total_naira", key: "invoiceTotalNaira" },
  { header: "product_name",        key: "productName" },
  { header: "product_sku",         key: "productSku" },
  { header: "quantity",            key: "quantity" },
  { header: "unit_cost_naira",     key: "unitCostNaira" },
  { header: "line_total_naira",    key: "lineTotalNaira" },
]

export function InvoiceExportButton() {
  return (
    <ExportButton
      filename="invoices"
      columns={COLUMNS}
      fetchRows={async () => {
        const rows = await fetchInvoiceExportRowsAction()
        return rows as unknown as Record<string, unknown>[]
      }}
    />
  )
}
