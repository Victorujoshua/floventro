"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ShoppingCart } from "lucide-react"
import { toast } from "sonner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RecordSaleDialog } from "@/components/app/sales/record-sale-dialog"
import type { SaleRow, SaleDetail } from "@/lib/db/queries/sales"
import { formatNaira } from "@/lib/format/money"
import { getSaleDetailAction } from "@/lib/db/actions/sales"

type Props = {
  sales: SaleRow[]
}

export function SalesClient({ sales }: Props) {
  const router = useRouter()
  const [newSaleOpen, setNewSaleOpen] = useState(false)
  const [detailSale, setDetailSale] = useState<SaleDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  async function openDetail(saleId: string) {
    setLoadingDetail(true)
    setDetailOpen(true)
    const detail = await getSaleDetailAction(saleId)
    setLoadingDetail(false)
    if (!detail) {
      toast.error("Could not load sale details.")
      setDetailOpen(false)
      return
    }
    setDetailSale(detail)
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Sales</h1>
          <p className="text-sm text-neutral-500 mt-1">Products sold from staff holdings</p>
        </div>
        <button
          onClick={() => setNewSaleOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
        >
          <ShoppingCart className="h-4 w-4" />
          New sale
        </button>
      </div>

      {sales.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center px-6">
          <ShoppingCart className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No sales yet</p>
          <p className="text-sm text-neutral-500 mt-1">
            Record a sale from your holding to see it here.
          </p>
          <button
            onClick={() => setNewSaleOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-9 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
          >
            <ShoppingCart className="h-4 w-4" />
            New sale
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50">
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Date</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Seller</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Customer</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Items</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TableRow
                  key={sale.id}
                  className="hover:bg-neutral-50/60 transition-colors cursor-pointer"
                  onClick={() => openDetail(sale.id)}
                >
                  <TableCell className="text-sm text-neutral-700 py-3.5">
                    {formatDate(sale.soldOn)}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-700 py-3.5">
                    {sale.sellerLabel}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-500 py-3.5">
                    {sale.customerName ?? <span className="text-neutral-300">—</span>}
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums text-neutral-700 py-3.5 text-right">
                    {sale.lineCount}
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums font-medium text-neutral-950 py-3.5 text-right">
                    <span className="font-inter">₦</span>
                    {formatNaira(sale.totalCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Sale detail sidebar */}
      <Dialog open={detailOpen} onOpenChange={(o) => { if (!o) { setDetailOpen(false); setDetailSale(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sale details</DialogTitle>
          </DialogHeader>
          {loadingDetail ? (
            <p className="text-sm text-neutral-500 py-4">Loading…</p>
          ) : detailSale ? (
            <div className="space-y-5 pt-1">
              {/* Meta */}
              <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Date</span>
                  <span className="text-neutral-950 font-medium">{formatDate(detailSale.soldOn)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Seller</span>
                  <span className="text-neutral-950 font-medium">{detailSale.sellerLabel}</span>
                </div>
                {detailSale.customerName && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Customer</span>
                    <span className="text-neutral-950">{detailSale.customerName}</span>
                  </div>
                )}
                {detailSale.customerPhone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Phone</span>
                    <span className="text-neutral-950 font-mono tabular-nums">{detailSale.customerPhone}</span>
                  </div>
                )}
                {detailSale.note && (
                  <div className="flex justify-between text-sm gap-4">
                    <span className="text-neutral-500 shrink-0">Note</span>
                    <span className="text-neutral-700 text-right">{detailSale.note}</span>
                  </div>
                )}
              </div>

              {/* Lines */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Products</p>
                <div className="rounded-lg border border-neutral-100 overflow-hidden divide-y divide-neutral-50">
                  {detailSale.lines.map((line) => (
                    <div key={line.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm text-neutral-950">{line.productName}</p>
                        <p className="text-xs font-mono text-neutral-400">
                          {line.productSku} · {line.quantity} × <span className="font-inter">₦</span>{formatNaira(line.unitPriceCents)}
                        </p>
                      </div>
                      <span className="text-sm font-mono tabular-nums font-medium text-neutral-950">
                        <span className="font-inter">₦</span>{formatNaira(line.lineTotalCents)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Total */}
              <div className="flex items-center justify-between rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3">
                <span className="text-sm font-semibold text-neutral-950">Total</span>
                <span className="text-base font-semibold tabular-nums text-neutral-950">
                  <span className="font-inter">₦</span>{formatNaira(detailSale.totalCents)}
                </span>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* New sale dialog */}
      <RecordSaleDialog
        open={newSaleOpen}
        onOpenChange={setNewSaleOpen}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}
