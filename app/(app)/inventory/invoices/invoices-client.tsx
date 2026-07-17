"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { MoreHorizontal, CreditCard, History } from "lucide-react"
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
import type { InvoicePayment } from "@/lib/db/queries/payments"
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
  total_cents:      number
  amount_paid_cents: number
  status:           string
  vendors:          { name: string } | { name: string }[] | null
}

function resolveVendorName(vendors: InvoiceRow["vendors"]): string {
  if (!vendors) return "—"
  if (Array.isArray(vendors)) return (vendors[0] as { name?: string })?.name ?? "—"
  return (vendors as { name?: string }).name ?? "—"
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, dueDate, today }: { status: string; dueDate: string | null; today: string }) {
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

// ── Record payment modal ──────────────────────────────────────────────────────

function RecordPaymentModal({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const router = useRouter()
  const today = new Date().toLocaleDateString("en-CA") // YYYY-MM-DD in local tz
  const outstanding = invoice.total_cents - invoice.amount_paid_cents

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PaymentInput>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      invoiceId:   invoice.id,
      paidOn:      today,
      method:      "bank_transfer",
    },
  })

  const [serverError, setServerError] = useState<string | null>(null)
  const amountNaira = watch("amountNaira")

  const amountCents  = amountNaira ? Math.round(amountNaira * 100) : 0
  const newPaid      = invoice.amount_paid_cents + amountCents
  const newOutstanding = Math.max(0, invoice.total_cents - newPaid)
  const previewStatus =
    newPaid <= 0              ? "Unpaid"
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-4">
      {/* Invoice summary strip */}
      <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 flex flex-col divide-y divide-neutral-100">
        <div className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
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
        <div className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
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

      {/* Amount */}
      <div className="space-y-1.5">
        <Label htmlFor="amountNaira">Amount (<span className="font-inter">₦</span>)</Label>
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

      {/* Payment date */}
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

      {/* Method */}
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

      {/* Reference */}
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

      {/* Note */}
      <div className="space-y-1.5">
        <Label htmlFor="note">
          Note{" "}
          <span className="text-neutral-400 font-normal">(optional)</span>
        </Label>
        <Textarea id="note" rows={2} {...register("note")} />
      </div>

      {/* Live preview */}
      {amountCents > 0 && (
        <div className="rounded-md bg-violet-50 border border-violet-100 px-4 py-2.5 text-sm text-violet-800">
          After this payment:{" "}
          <span className="font-semibold tabular-nums">
            <span className="font-inter">₦</span>{formatNaira(newPaid)}
          </span>{" "}
          paid,{" "}
          <span className="font-semibold tabular-nums">
            <span className="font-inter">₦</span>{formatNaira(newOutstanding)}
          </span>{" "}
          outstanding — <span className="font-semibold">{previewStatus}</span>
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

  return (
    <div className="mt-4 -mx-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100">
            <th className="px-4 pb-2 text-left text-xs font-medium text-neutral-500 whitespace-nowrap">Date</th>
            <th className="px-4 pb-2 text-right text-xs font-medium text-neutral-500 whitespace-nowrap">Amount</th>
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

// ── Main export ───────────────────────────────────────────────────────────────

export function InvoicesClient({ invoices }: { invoices: InvoiceRow[] }) {
  const today = new Date().toLocaleDateString("en-CA") // YYYY-MM-DD in local tz

  const [payModal,  setPayModal]  = useState<InvoiceRow | null>(null)
  const [histModal, setHistModal] = useState<InvoiceRow | null>(null)

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
                Status
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => {
              const outstanding = inv.total_cents - inv.amount_paid_cents
              const isPaid      = inv.status === "paid"

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
                    <StatusBadge
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
