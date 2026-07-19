"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { MoreHorizontal, CreditCard, History, PackagePlus } from "lucide-react"
import { formatNaira } from "@/lib/format/money"
import {
  paymentSchema,
  type PaymentInput,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
} from "@/lib/validation/payments"
import {
  recordPaymentAction,
  getInvoicePaymentsAction,
} from "@/lib/db/actions/payments"
import {
  getInvoiceForReceivingAction,
  receiveInvoiceStockAction,
} from "@/lib/db/actions/invoices"
import type { InvoicePayment } from "@/lib/db/queries/payments"
import type { InvoiceForReceiving } from "@/lib/db/queries/invoices"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

// ── Types ─────────────────────────────────────────────────────────────────────

export type InvoiceRow = {
  id:               string
  invoice_number:   string | null
  invoice_date:     string
  due_date:         string | null
  subtotal_cents:   number | null
  vat_rate:         number | null
  vat_cents:        number | null
  total_cents:      number
  amount_paid_cents: number
  status:           string
  receipt_status:   string
  vendors:          { name: string } | { name: string }[] | null
}

function resolveVendorName(vendors: InvoiceRow["vendors"]): string {
  if (!vendors) return "—"
  if (Array.isArray(vendors)) return (vendors[0] as { name?: string })?.name ?? "—"
  return (vendors as { name?: string }).name ?? "—"
}

// ── Payment status badge ──────────────────────────────────────────────────────

function PaymentBadge({ status, dueDate, today }: { status: string; dueDate: string | null; today: string }) {
  const effective =
    status === "paid"
      ? "paid"
      : dueDate && dueDate < today
      ? "past_due"
      : status

  const map: Record<string, { label: string; className: string }> = {
    unpaid:   { label: "Unpaid",   className: "bg-neutral-100 text-neutral-600" },
    partial:  { label: "Partial",  className: "bg-tint-amber text-amber-700" },
    paid:     { label: "Paid",     className: "bg-tint-success text-green-700" },
    past_due: { label: "Past due", className: "bg-tint-coral text-red-700" },
  }
  const entry = map[effective] ?? map.unpaid

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${entry.className}`}>
      {entry.label}
    </span>
  )
}

// ── Receipt status badge ──────────────────────────────────────────────────────

function ReceiptBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending:            { label: "Awaiting delivery",  className: "bg-tint-amber text-amber-700" },
    partially_received: { label: "Partially received", className: "bg-tint-amber text-amber-700" },
    received:           { label: "Received",           className: "bg-tint-success text-green-700" },
  }
  const entry = map[status] ?? { label: status, className: "bg-neutral-100 text-neutral-500" }

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${entry.className}`}>
      {entry.label}
    </span>
  )
}

// ── Record payment modal ──────────────────────────────────────────────────────

function RecordPaymentModal({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const router = useRouter()
  const today = new Date().toLocaleDateString("en-CA")
  const outstanding = invoice.total_cents - invoice.amount_paid_cents
  const subtotalCents = invoice.subtotal_cents ?? invoice.total_cents

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PaymentInput>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      invoiceId: invoice.id,
      paidOn:    today,
      method:    "bank_transfer",
      whtRate:   null,
    },
  })

  const [serverError, setServerError] = useState<string | null>(null)
  const amountNaira = watch("amountNaira")
  const whtRateRaw  = watch("whtRate")
  const whtRate     = typeof whtRateRaw === "number" && !isNaN(whtRateRaw) && whtRateRaw > 0 ? whtRateRaw : 0

  const amountCents     = amountNaira ? Math.round(amountNaira * 100) : 0
  const whtCents        = whtRate > 0 ? Math.round(subtotalCents * whtRate / 100) : 0
  const settlementCents = amountCents + whtCents
  const newPaid         = invoice.amount_paid_cents + settlementCents
  const newOutstanding  = Math.max(0, invoice.total_cents - newPaid)
  const previewStatus   =
    newPaid <= 0                    ? "Unpaid"
    : newPaid < invoice.total_cents ? "Partial"
    : "Paid"

  async function onSubmit(data: PaymentInput) {
    setServerError(null)
    const result = await recordPaymentAction(data)
    if (!result.ok) {
      setServerError(result.message ?? result.error)
      return
    }
    toast.success("Payment recorded")
    onClose()
    router.refresh()
  }

  const hasVat = (invoice.vat_cents ?? 0) > 0

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
      {/* Invoice summary */}
      <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 flex flex-col divide-y divide-neutral-100">
        {hasVat && (
          <>
            <div className="flex items-center justify-between py-2 first:pt-0">
              <p className="text-xs text-neutral-500">Subtotal</p>
              <p className="text-sm tabular-nums text-neutral-700">
                <span className="font-inter">₦</span>{formatNaira(subtotalCents)}
              </p>
            </div>
            <div className="flex items-center justify-between py-2">
              <p className="text-xs text-neutral-500">VAT ({invoice.vat_rate}%)</p>
              <p className="text-sm tabular-nums text-neutral-700">
                <span className="font-inter">₦</span>{formatNaira(invoice.vat_cents ?? 0)}
              </p>
            </div>
          </>
        )}
        <div className="flex items-center justify-between py-2 first:pt-0">
          <p className="text-xs text-neutral-500">Total</p>
          <p className="text-sm font-semibold tabular-nums text-neutral-950">
            <span className="font-inter">₦</span>{formatNaira(invoice.total_cents)}
          </p>
        </div>
        <div className="flex items-center justify-between py-2">
          <p className="text-xs text-neutral-500">Paid</p>
          <p className="text-sm font-semibold tabular-nums text-neutral-950">
            <span className="font-inter">₦</span>{formatNaira(invoice.amount_paid_cents)}
          </p>
        </div>
        <div className="flex items-center justify-between py-2 last:pb-0">
          <p className="text-xs text-neutral-500">Outstanding</p>
          <p className="text-sm font-semibold tabular-nums text-red-600">
            <span className="font-inter">₦</span>{formatNaira(outstanding)}
          </p>
        </div>
      </div>

      {serverError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {serverError}
        </div>
      )}

      <input type="hidden" {...register("invoiceId")} />

      {/* Cash paid */}
      <div className="space-y-1.5">
        <Label htmlFor="amountNaira">
          Cash paid (<span className="font-inter">₦</span>)
        </Label>
        <div className="flex gap-2">
          <Input
            id="amountNaira"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            className="tabular-nums"
            aria-invalid={!!errors.amountNaira}
            {...register("amountNaira", { valueAsNumber: true })}
          />
          <button
            type="button"
            onClick={() => setValue("amountNaira", outstanding / 100, { shouldValidate: true })}
            className="shrink-0 rounded-md border border-neutral-200 px-3 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors whitespace-nowrap"
          >
            Pay full
          </button>
        </div>
        {errors.amountNaira && (
          <p className="text-xs text-red-600">{errors.amountNaira.message}</p>
        )}
      </div>

      {/* WHT % */}
      <div className="space-y-1.5">
        <Label htmlFor="whtRate">
          Withholding tax %{" "}
          <span className="text-neutral-400 font-normal">(optional)</span>
        </Label>
        <div className="relative max-w-[180px]">
          <Input
            id="whtRate"
            type="number"
            min={0}
            max={100}
            step="0.01"
            placeholder="e.g. 5"
            className="rounded-md pr-8"
            aria-invalid={!!errors.whtRate}
            {...register("whtRate", {
              setValueAs: (v) => v === "" || v === null ? null : Number(v),
            })}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">%</span>
        </div>
        {errors.whtRate && (
          <p className="text-xs text-red-600">{errors.whtRate.message}</p>
        )}
        <p className="text-xs text-neutral-400">
          Withholding tax is deducted from the vendor and remitted to FIRS; the invoice is settled by cash + WHT.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="paidOn">Payment date</Label>
        <Input
          id="paidOn"
          type="date"
          aria-invalid={!!errors.paidOn}
          {...register("paidOn")}
        />
        {errors.paidOn && (
          <p className="text-xs text-red-600">{errors.paidOn.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="method">Method</Label>
        <select
          id="method"
          className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
          {...register("method")}
        >
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
        {errors.method && (
          <p className="text-xs text-red-600">{errors.method.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reference">
          Reference{" "}
          <span className="text-neutral-400 font-normal">(optional)</span>
        </Label>
        <Input
          id="reference"
          type="text"
          placeholder="Transfer ref, cheque number, etc."
          {...register("reference")}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="note">
          Note{" "}
          <span className="text-neutral-400 font-normal">(optional)</span>
        </Label>
        <Textarea id="note" rows={2} {...register("note")} />
      </div>

      {/* Settlement preview */}
      {amountCents > 0 && (
        <div className="rounded-md bg-violet-50 border border-violet-100 px-4 py-3 text-sm text-violet-800 space-y-1">
          <div className="flex justify-between tabular-nums">
            <span>Cash paid</span>
            <span className="font-semibold"><span className="font-inter">₦</span>{formatNaira(amountCents)}</span>
          </div>
          {whtCents > 0 && (
            <div className="flex justify-between tabular-nums">
              <span>WHT withheld ({whtRate}%)</span>
              <span className="font-semibold"><span className="font-inter">₦</span>{formatNaira(whtCents)}</span>
            </div>
          )}
          <div className="flex justify-between tabular-nums border-t border-violet-200 pt-1 mt-1">
            <span>Settles</span>
            <span className="font-semibold"><span className="font-inter">₦</span>{formatNaira(settlementCents)}</span>
          </div>
          <div className="flex justify-between tabular-nums">
            <span>Balance after</span>
            <span className="font-semibold">
              <span className="font-inter">₦</span>{formatNaira(newOutstanding)} — {previewStatus}
            </span>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-neutral-200 px-4 h-10 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-violet-700 text-white px-4 h-10 text-sm font-medium hover:bg-violet-800 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Recording…" : "Record payment"}
        </button>
      </div>
    </form>
  )
}

// ── Payment history modal ─────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  cash:          "Cash",
  cheque:        "Cheque",
  pos:           "POS",
  other:         "Other",
}

function PaymentHistoryModal({ invoiceId }: { invoiceId: string }) {
  const [payments, setPayments] = useState<InvoicePayment[] | null>(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    getInvoicePaymentsAction(invoiceId).then((data) => {
      setPayments(data)
      setLoading(false)
    })
  }, [invoiceId])

  if (loading) {
    return <p className="mt-4 text-sm text-neutral-500 py-6 text-center">Loading…</p>
  }

  if (!payments || payments.length === 0) {
    return (
      <p className="mt-4 text-sm text-neutral-500 py-6 text-center">
        No payments recorded yet.
      </p>
    )
  }

  const hasWht = payments.some((p) => (p.wht_cents ?? 0) > 0)

  return (
    <div className="mt-4 -mx-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100">
            <th className="px-4 pb-2 text-left text-xs font-medium text-neutral-500 whitespace-nowrap">Date</th>
            <th className="px-4 pb-2 text-right text-xs font-medium text-neutral-500 whitespace-nowrap">Cash paid</th>
            {hasWht && (
              <th className="px-4 pb-2 text-right text-xs font-medium text-neutral-500 whitespace-nowrap">WHT withheld</th>
            )}
            <th className="px-4 pb-2 text-left text-xs font-medium text-neutral-500 whitespace-nowrap">Method</th>
            <th className="px-4 pb-2 text-left text-xs font-medium text-neutral-500 whitespace-nowrap">Reference</th>
            <th className="px-4 pb-2 text-left text-xs font-medium text-neutral-500 whitespace-nowrap">Recorded by</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-b border-neutral-50 last:border-0">
              <td className="px-4 py-2.5 text-neutral-700 whitespace-nowrap">{p.paid_on}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-medium text-neutral-950 whitespace-nowrap">
                <span className="font-inter">₦</span>{formatNaira(p.amount_cents)}
              </td>
              {hasWht && (
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-700 whitespace-nowrap">
                  {(p.wht_cents ?? 0) > 0 ? (
                    <>
                      <span className="font-inter">₦</span>{formatNaira(p.wht_cents ?? 0)}
                      {p.wht_rate != null && (
                        <span className="ml-1 text-xs text-neutral-400">({p.wht_rate}%)</span>
                      )}
                    </>
                  ) : (
                    <span className="text-neutral-300">—</span>
                  )}
                </td>
              )}
              <td className="px-4 py-2.5 text-neutral-700">{METHOD_LABELS[p.method] ?? p.method}</td>
              <td className="px-4 py-2.5 text-neutral-500">
                {p.reference ?? <span className="text-neutral-300">—</span>}
              </td>
              <td className="px-4 py-2.5 text-neutral-600">{p.recorder_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Receive invoice stock modal ───────────────────────────────────────────────

function ReceiveInvoiceForm({
  invoice,
  onClose,
  onSuccess,
}: {
  invoice: InvoiceForReceiving
  onClose: () => void
  onSuccess: () => void
}) {
  const [quantities, setQuantities] = useState<number[]>(
    invoice.lines.map((l) => l.remaining),
  )
  const [note, setNote]             = useState("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function setQty(index: number, value: number) {
    setQuantities((prev) => prev.map((q, i) => (i === index ? value : q)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const lines = invoice.lines
      .map((l, i) => ({ lineId: l.id, quantityReceived: quantities[i] ?? 0 }))
      .filter((l) => l.quantityReceived > 0)

    if (lines.length === 0) {
      setSubmitError("Enter at least one quantity greater than 0.")
      return
    }

    setSubmitError(null)
    setIsSubmitting(true)
    try {
      const result = await receiveInvoiceStockAction(invoice.id, lines, note)
      if (!result.ok) {
        setSubmitError(result.error)
        return
      }
      toast.success("Stock received")
      onClose()
      onSuccess()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-5">
      {/* Lines table */}
      <div className="rounded-lg border border-neutral-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200">
              <th className="px-3 py-2 text-left text-xs font-medium text-neutral-500 w-full">Product</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-neutral-500 whitespace-nowrap">Ordered</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-neutral-500 whitespace-nowrap">Received</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-neutral-500 whitespace-nowrap">Remaining</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-neutral-500 whitespace-nowrap">Receiving now</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={line.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-3 py-2.5">
                  <p className="font-medium text-neutral-950">{line.productName}</p>
                  <p className="text-xs font-mono text-neutral-400">{line.productSku}</p>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-neutral-500">
                  {line.quantity}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-neutral-500">
                  {line.quantityReceived}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-neutral-500">
                  {line.remaining}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Input
                    type="number"
                    min={0}
                    max={line.remaining}
                    value={quantities[index] ?? 0}
                    onChange={(e) => setQty(index, Math.max(0, Math.min(line.remaining, parseInt(e.target.value, 10) || 0)))}
                    className="h-8 w-20 text-sm tabular-nums text-right ml-auto"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Running summary */}
      {(() => {
        const total = quantities.reduce((s, q) => s + (q || 0), 0)
        const count = quantities.filter((q) => q > 0).length
        return total > 0 ? (
          <p className="text-xs text-neutral-500 tabular-nums">
            Receiving <span className="font-medium text-neutral-950">{total}</span> unit{total !== 1 ? "s" : ""} across{" "}
            <span className="font-medium text-neutral-950">{count}</span> line{count !== 1 ? "s" : ""}
          </p>
        ) : null
      })()}

      {/* Note */}
      <div className="space-y-1.5">
        <Label htmlFor="receive-note">
          Note{" "}
          <span className="text-neutral-400 font-normal">(optional)</span>
        </Label>
        <textarea
          id="receive-note"
          rows={2}
          placeholder="e.g. 2 units short, backordered"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
        />
      </div>

      {submitError && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
          {submitError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-neutral-200 px-4 h-10 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-neutral-800 text-white px-4 h-10 text-sm font-medium hover:bg-neutral-900 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Receiving…" : "Confirm receipt"}
        </button>
      </div>
    </form>
  )
}

function ReceiveInvoiceModal({
  invoice,
  onClose,
  onSuccess,
}: {
  invoice: InvoiceRow | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [data, setData]       = useState<InvoiceForReceiving | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!invoice) return
    setLoading(true)
    setData(null)
    getInvoiceForReceivingAction(invoice.id).then((d) => {
      setData(d)
      setLoading(false)
    })
  }, [invoice?.id])

  return (
    <Dialog
      open={invoice !== null}
      onOpenChange={(open: boolean) => { if (!open) onClose() }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receive stock</DialogTitle>
          {invoice && (
            <p className="text-sm text-neutral-500">
              {resolveVendorName(invoice.vendors)}
              {invoice.invoice_number ? ` · ${invoice.invoice_number}` : ""}
            </p>
          )}
        </DialogHeader>

        {loading && (
          <p className="text-sm text-neutral-500 py-6 text-center">Loading…</p>
        )}
        {!loading && data && (
          <ReceiveInvoiceForm
            key={data.id}
            invoice={data}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        )}
        {!loading && !data && invoice && (
          <p className="text-sm text-red-600 py-4">Failed to load invoice lines. Please try again.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function InvoicesClient({ invoices }: { invoices: InvoiceRow[] }) {
  const router = useRouter()
  const today  = new Date().toLocaleDateString("en-CA")

  const [payModal,     setPayModal]     = useState<InvoiceRow | null>(null)
  const [histModal,    setHistModal]    = useState<InvoiceRow | null>(null)
  const [receiveModal, setReceiveModal] = useState<InvoiceRow | null>(null)

  return (
    <>
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
              <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">
                Outstanding
              </TableHead>
              <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Delivery
              </TableHead>
              <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Payment
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => {
              const outstanding     = inv.total_cents - inv.amount_paid_cents
              const isPaid          = inv.status === "paid"
              const isFullyReceived = inv.receipt_status === "received"

              return (
                <TableRow key={inv.id} className="hover:bg-neutral-50/60 transition-colors">
                  <TableCell className="text-sm font-mono tabular-nums text-neutral-700 py-3.5">
                    {inv.invoice_number ?? <span className="text-neutral-400">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-950 py-3.5">
                    {resolveVendorName(inv.vendors)}
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
                  <TableCell className="text-sm font-mono tabular-nums py-3.5 text-right">
                    <span className={isPaid ? "text-green-600" : "text-neutral-950"}>
                      <span className="font-inter">₦</span>{formatNaira(outstanding)}
                    </span>
                  </TableCell>
                  <TableCell className="py-3.5">
                    <ReceiptBadge status={inv.receipt_status} />
                  </TableCell>
                  <TableCell className="py-3.5">
                    <PaymentBadge
                      status={inv.status}
                      dueDate={inv.due_date}
                      today={today}
                    />
                  </TableCell>
                  <TableCell className="py-3.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
                        aria-label="Invoice actions"
                      >
                        <MoreHorizontal size={16} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
                        {!isFullyReceived && (
                          <DropdownMenuItem
                            className="gap-2"
                            onClick={() => setReceiveModal(inv)}
                          >
                            <PackagePlus size={14} />
                            Receive stock
                          </DropdownMenuItem>
                        )}
                        {!isPaid && (
                          <DropdownMenuItem
                            className="gap-2"
                            onClick={() => setPayModal(inv)}
                          >
                            <CreditCard size={14} />
                            Record payment
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="gap-2"
                          onClick={() => setHistModal(inv)}
                        >
                          <History size={14} />
                          View payments
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Receive stock dialog */}
      <ReceiveInvoiceModal
        invoice={receiveModal}
        onClose={() => setReceiveModal(null)}
        onSuccess={() => router.refresh()}
      />

      {/* Record payment dialog */}
      <Dialog
        open={payModal !== null}
        onOpenChange={(open: boolean) => { if (!open) setPayModal(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            {payModal && (
              <p className="text-sm text-neutral-500">
                {resolveVendorName(payModal.vendors)}
                {payModal.invoice_number ? ` · ${payModal.invoice_number}` : ""}
              </p>
            )}
          </DialogHeader>
          {payModal && (
            <RecordPaymentModal
              key={payModal.id}
              invoice={payModal}
              onClose={() => setPayModal(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Payment history dialog */}
      <Dialog
        open={histModal !== null}
        onOpenChange={(open: boolean) => { if (!open) setHistModal(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment history</DialogTitle>
            {histModal && (
              <p className="text-sm text-neutral-500">
                {resolveVendorName(histModal.vendors)}
                {histModal.invoice_number ? ` · ${histModal.invoice_number}` : ""}
              </p>
            )}
          </DialogHeader>
          {histModal && (
            <PaymentHistoryModal key={histModal.id} invoiceId={histModal.id} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
