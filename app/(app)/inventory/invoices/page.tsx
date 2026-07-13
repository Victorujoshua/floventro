import Link from "next/link"
import { requireRole } from "@/lib/auth/guards"
import { getInvoices } from "@/lib/db/queries/invoices"
import { formatNaira } from "@/lib/format/money"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FileText, Plus } from "lucide-react"

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    unpaid:  { label: "Unpaid",  className: "bg-neutral-100 text-neutral-600" },
    partial: { label: "Partial", className: "bg-tint-amber text-amber-700" },
    paid:    { label: "Paid",    className: "bg-tint-success text-green-700" },
  }
  const entry = map[status] ?? map.unpaid
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${entry.className}`}>
      {entry.label}
    </span>
  )
}

function vendorName(vendors: unknown): string {
  if (!vendors) return "—"
  if (Array.isArray(vendors)) return (vendors[0] as { name?: string })?.name ?? "—"
  return (vendors as { name?: string }).name ?? "—"
}

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

      {/* Empty state */}
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
        <div className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50">
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Invoice #
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Vendor
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Date
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Due date
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">
                  Total
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id} className="hover:bg-neutral-50/60 transition-colors">
                  <TableCell className="text-sm font-mono tabular-nums text-neutral-700 py-3.5">
                    {inv.invoice_number ?? <span className="text-neutral-400">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-950 py-3.5">
                    {vendorName(inv.vendors)}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-700 py-3.5">
                    {inv.invoice_date}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-700 py-3.5">
                    {inv.due_date ?? <span className="text-neutral-400">—</span>}
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums text-neutral-950 py-3.5 text-right">
                    <span className="font-inter">₦</span>{formatNaira(inv.total_cents)}
                  </TableCell>
                  <TableCell className="py-3.5">
                    <StatusBadge status={inv.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
