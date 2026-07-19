"use client"
// cache-bust: force fresh chunk after stale SaleDetail bundle

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { ShoppingCart, MoreHorizontal, CreditCard, FileText } from "lucide-react"
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
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { RecordSaleDialog } from "@/components/app/sales/record-sale-dialog"
import { salePaymentSchema, type SalePaymentInput } from "@/lib/validation/sales"
import type { SaleRow, SaleDetail } from "@/lib/db/queries/sales"
import { formatNaira } from "@/lib/format/money"
import { getSaleDetailAction, recordSalePaymentAction } from "@/lib/db/actions/sales"

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  pos: "POS",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
}

const PAYMENT_METHODS = [
  { value: "cash",          label: "Cash" },
  { value: "pos",           label: "POS" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque",        label: "Cheque" },
  { value: "other",         label: "Other" },
]

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 disabled:cursor-not-allowed disabled:opacity-50"

function todayIso() {
  return new Date().toLocaleDateString("en-CA")
}

// ── Payment badge ─────────────────────────────────────────────────────────────

function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    paid:    { label: "Paid",     className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    unpaid:  { label: "Unpaid",   className: "bg-amber-50 text-amber-700 border-amber-200" },
    partial: { label: "Partial",  className: "bg-amber-50 text-amber-700 border-amber-200" },
  }
  const { label, className } = map[status] ?? { label: status, className: "bg-neutral-50 text-neutral-600 border-neutral-200" }
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

// ── Mark as paid modal ────────────────────────────────────────────────────────

function MarkAsPaidModal({
  sale,
  onClose,
  onSuccess,
}: {
  sale: SaleRow | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  const outstandingCents = sale ? sale.totalCents - sale.amountPaidCents : 0

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SalePaymentInput>({
    resolver: zodResolver(salePaymentSchema),
    values: {
      amountNaira: outstandingCents / 100,
      paidOn: todayIso(),
      method: undefined,
      note: "",
    },
  })

  function handleClose() {
    reset()
    setSubmitError(null)
    onClose()
  }

  async function onSubmit(values: SalePaymentInput) {
    if (!sale) return
    setSubmitError(null)
    const result = await recordSalePaymentAction(
      sale.id,
      values.amountNaira,
      values.paidOn,
      values.method ?? null,
      values.note ?? "",
    )
    if (!result.ok) {
      setSubmitError(result.message ?? result.error)
      return
    }
    toast.success("Payment recorded")
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={sale !== null} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as paid</DialogTitle>
        </DialogHeader>

        {sale && (
          <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-500">Sale total</span>
              <span className="tabular-nums font-medium text-neutral-950">
                <span className="font-inter">₦</span>{formatNaira(sale.totalCents)}
              </span>
            </div>
            {sale.amountPaidCents > 0 && (
              <div className="flex justify-between">
                <span className="text-neutral-500">Already paid</span>
                <span className="tabular-nums text-emerald-700">
                  <span className="font-inter">₦</span>{formatNaira(sale.amountPaidCents)}
                </span>
              </div>
            )}
            <div className="flex justify-between font-medium border-t border-neutral-200 pt-1 mt-1">
              <span className="text-neutral-700">Outstanding</span>
              <span className="tabular-nums text-neutral-950">
                <span className="font-inter">₦</span>{formatNaira(outstandingCents)}
              </span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mp-amount">Amount (<span className="font-inter">₦</span>)</Label>
              <Input
                id="mp-amount"
                type="number"
                min={0.01}
                step="0.01"
                className="h-9 text-sm tabular-nums"
                {...register("amountNaira", { valueAsNumber: true })}
              />
              {errors.amountNaira && (
                <p className="text-xs text-red-500">{errors.amountNaira.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mp-paid-on">Date</Label>
              <Input id="mp-paid-on" type="date" className="h-9 text-sm" {...register("paidOn")} />
              {errors.paidOn && (
                <p className="text-xs text-red-500">{errors.paidOn.message}</p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-method">
              Method <span className="text-neutral-400 font-normal">(optional)</span>
            </Label>
            <select id="mp-method" className={SELECT_CLASS} {...register("method")}>
              <option value="">Select…</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mp-note">
              Note <span className="text-neutral-400 font-normal">(optional)</span>
            </Label>
            <Input id="mp-note" placeholder="e.g. cash collected at branch" className="h-9 text-sm" {...register("note")} />
          </div>

          {submitError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {submitError}
            </p>
          )}
        </form>

        <DialogFooter showCloseButton>
          <Button
            type="button"
            disabled={isSubmitting || !sale}
            onClick={handleSubmit(onSubmit)}
            className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-md"
          >
            {isSubmitting ? "Recording…" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

type Props = {
  sales: SaleRow[]
}

export function SalesClient({ sales }: Props) {
  const router = useRouter()
  const [newSaleOpen, setNewSaleOpen] = useState(false)
  const [detailSale, setDetailSale] = useState<SaleDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [markPaidSale, setMarkPaidSale] = useState<SaleRow | null>(null)

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
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Method</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Payment</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Items</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Total</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => {
                const canMarkPaid = sale.paymentStatus === "unpaid" || sale.paymentStatus === "partial"
                return (
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
                    <TableCell className="text-sm text-neutral-500 py-3.5">
                      {sale.paymentMethod
                        ? PAYMENT_METHOD_LABELS[sale.paymentMethod] ?? sale.paymentMethod
                        : <span className="text-neutral-300">—</span>}
                    </TableCell>
                    <TableCell className="py-3.5">
                      <PaymentBadge status={sale.paymentStatus} />
                    </TableCell>
                    <TableCell className="text-sm font-mono tabular-nums text-neutral-700 py-3.5 text-right">
                      {sale.lineCount}
                    </TableCell>
                    <TableCell className="text-sm font-mono tabular-nums font-medium text-neutral-950 py-3.5 text-right">
                      <span className="font-inter">₦</span>
                      {formatNaira(sale.totalCents)}
                    </TableCell>
                    <TableCell
                      className="py-3.5 text-right w-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors">
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => window.open(`/sales/${sale.id}/invoice`, "_blank")}
                          >
                            <FileText className="h-3.5 w-3.5 mr-2" />
                            View invoice
                          </DropdownMenuItem>
                          {canMarkPaid && (
                            <DropdownMenuItem onClick={() => setMarkPaidSale(sale)}>
                              <CreditCard className="h-3.5 w-3.5 mr-2" />
                              Mark as paid
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
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
                {detailSale.paymentMethod && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Payment method</span>
                    <span className="text-neutral-950">
                      {PAYMENT_METHOD_LABELS[detailSale.paymentMethod] ?? detailSale.paymentMethod}
                    </span>
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

              {/* Payment summary */}
              <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-500">Total</span>
                  <span className="font-semibold tabular-nums text-neutral-950">
                    <span className="font-inter">₦</span>{formatNaira(detailSale.totalCents)}
                  </span>
                </div>
                {detailSale.amountPaidCents > 0 && detailSale.amountPaidCents < detailSale.totalCents && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-neutral-500">Paid</span>
                    <span className="tabular-nums text-emerald-700">
                      <span className="font-inter">₦</span>{formatNaira(detailSale.amountPaidCents)}
                    </span>
                  </div>
                )}
                {detailSale.paymentStatus !== "paid" && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-neutral-500">Outstanding</span>
                    <span className="tabular-nums text-amber-700">
                      <span className="font-inter">₦</span>{formatNaira(detailSale.totalCents - detailSale.amountPaidCents)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1 border-t border-neutral-200">
                  <span className="text-sm text-neutral-500">Payment status</span>
                  <PaymentBadge status={detailSale.paymentStatus} />
                </div>
              </div>

              {/* Invoice link */}
              <a
                href={`/sales/${detailSale.id}/invoice`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 w-full rounded-md border border-neutral-200 px-4 h-9 text-sm text-neutral-700 hover:bg-neutral-50 hover:border-neutral-300 transition-colors"
              >
                <FileText className="h-3.5 w-3.5 text-neutral-400" />
                View / print invoice
              </a>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Mark as paid modal */}
      <MarkAsPaidModal
        sale={markPaidSale}
        onClose={() => setMarkPaidSale(null)}
        onSuccess={() => {
          setMarkPaidSale(null)
          router.refresh()
        }}
      />

      {/* New sale dialog */}
      <RecordSaleDialog
        open={newSaleOpen}
        onOpenChange={setNewSaleOpen}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}
