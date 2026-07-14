import Link from "next/link"
import { requireRole } from "@/lib/auth/guards"
import { getInvoices } from "@/lib/db/queries/invoices"
import { FileText, Plus } from "lucide-react"
import { InvoicesClient, type InvoiceRow } from "./invoices-client"

export default async function InvoicesPage() {
  await requireRole("owner", "inventory")
  const invoices = await getInvoices()

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Invoices</h1>
          <p className="text-sm text-neutral-500 mt-1">Vendor invoices and stock received</p>
        </div>
        <Link
          href="/inventory/invoices/new"
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Record invoice
        </Link>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center">
          <FileText className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No invoices yet</p>
          <p className="text-sm text-neutral-500 mt-1">
            Record your first vendor invoice to bring stock in.
          </p>
          <Link
            href="/inventory/invoices/new"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Record invoice
          </Link>
        </div>
      ) : (
        <InvoicesClient invoices={invoices as InvoiceRow[]} />
      )}
    </div>
  )
}
