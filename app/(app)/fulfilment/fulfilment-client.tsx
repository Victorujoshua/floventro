"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { PackageCheck, Plus, Trash2, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { createFulfilmentOrderSchema, type CreateFulfilmentOrderInput } from "@/lib/validation/fulfilment"
import { createFulfilmentOrderAction } from "@/lib/db/actions/fulfilment"
import type { FulfilmentOrder } from "@/lib/db/queries/fulfilment"
import { formatNaira } from "@/lib/format/money"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { Role } from "@/lib/auth/scope"

// ── Types ─────────────────────────────────────────────────────────────────────

type ProductOption = {
  id: string
  sku: string
  name: string
  default_price_cents: number | null
}

type Props = {
  orders: FulfilmentOrder[]
  products: ProductOption[]
  role: Role
  hasBranch: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 disabled:cursor-not-allowed disabled:opacity-50"

const PAYMENT_METHODS = [
  { value: "cash",          label: "Cash" },
  { value: "pos",           label: "POS" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque",        label: "Cheque" },
  { value: "other",         label: "Other" },
]

const STATUS_FILTERS = ["all", "pending", "packed", "shipped", "delivered", "cancelled"] as const
type StatusFilter = typeof STATUS_FILTERS[number]

// ── Status badge ──────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending:   { label: "Pending",   className: "bg-amber-50 text-amber-700 border-amber-200" },
    packed:    { label: "Packed",    className: "bg-blue-50 text-blue-700 border-blue-200" },
    shipped:   { label: "Shipped",   className: "bg-purple-50 text-purple-700 border-purple-200" },
    delivered: { label: "Delivered", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    cancelled: { label: "Cancelled", className: "bg-neutral-100 text-neutral-500 border-neutral-200" },
  }
  const { label, className } = map[status] ?? { label: status, className: "bg-neutral-50 text-neutral-600 border-neutral-200" }
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

// ── Payment badge ─────────────────────────────────────────────────────────────

function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    paid:    { label: "Paid",    className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    unpaid:  { label: "Unpaid",  className: "bg-amber-50 text-amber-700 border-amber-200" },
    partial: { label: "Partial", className: "bg-amber-50 text-amber-700 border-amber-200" },
  }
  const { label, className } = map[status] ?? { label: status, className: "bg-neutral-50 text-neutral-600 border-neutral-200" }
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

// ── Create order dialog ───────────────────────────────────────────────────────

function CreateOrderDialog({
  open,
  onOpenChange,
  products,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  products: ProductOption[]
  onSuccess: () => void
}) {
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateFulfilmentOrderInput>({
    resolver: zodResolver(createFulfilmentOrderSchema),
    defaultValues: {
      distributorName:  "",
      distributorPhone: "",
      distributorEmail: "",
      note:             "",
      paymentMethod:    undefined,
      paymentStatus:    "unpaid",
      lines: [{ productId: "", quantity: 1, unitPriceNaira: 0 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  const watchedLines = watch("lines")
  const paymentStatus = watch("paymentStatus")

  const grandTotal = (watchedLines ?? []).reduce(
    (sum, l) => sum + (l.quantity || 0) * (l.unitPriceNaira || 0), 0,
  )

  function handleProductChange(index: number, productId: string) {
    const product = products.find((p) => p.id === productId)
    if (product?.default_price_cents != null) {
      setValue(`lines.${index}.unitPriceNaira`, product.default_price_cents / 100)
    }
  }

  async function onSubmit(data: CreateFulfilmentOrderInput) {
    setSubmitError(null)
    const result = await createFulfilmentOrderAction(data)
    if (!result.ok) {
      setSubmitError(result.message ?? "Something went wrong")
      return
    }
    toast.success("Order created")
    reset()
    onOpenChange(false)
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isSubmitting) { reset(); setSubmitError(null); onOpenChange(v) } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New fulfilment order</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-1">
          {/* Distributor info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="distributorName">Distributor name <span className="text-red-500">*</span></Label>
              <Input
                id="distributorName"
                placeholder="ABC Distributors Ltd"
                {...register("distributorName")}
              />
              {errors.distributorName && (
                <p className="text-xs text-red-500">{errors.distributorName.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="distributorPhone">Phone</Label>
              <Input id="distributorPhone" placeholder="08012345678" {...register("distributorPhone")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="distributorEmail">Email</Label>
              <Input id="distributorEmail" type="email" placeholder="orders@abc.com" {...register("distributorEmail")} />
            </div>
          </div>

          {/* Lines */}
          <div className="space-y-2">
            <Label>Products</Label>
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-[1fr_80px_120px_32px] gap-2 items-start">
                <div>
                  <select
                    className={SELECT_CLASS}
                    {...register(`lines.${index}.productId`)}
                    onChange={(e) => {
                      register(`lines.${index}.productId`).onChange(e)
                      handleProductChange(index, e.target.value)
                    }}
                  >
                    <option value="">Select product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                  {errors.lines?.[index]?.productId && (
                    <p className="text-xs text-red-500 mt-0.5">{errors.lines[index]?.productId?.message}</p>
                  )}
                </div>
                <div>
                  <Input
                    type="number"
                    min="1"
                    placeholder="Qty"
                    {...register(`lines.${index}.quantity`, { valueAsNumber: true })}
                  />
                  {errors.lines?.[index]?.quantity && (
                    <p className="text-xs text-red-500 mt-0.5">{errors.lines[index]?.quantity?.message}</p>
                  )}
                </div>
                <div>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Unit price"
                    {...register(`lines.${index}.unitPriceNaira`, { valueAsNumber: true })}
                  />
                  {errors.lines?.[index]?.unitPriceNaira && (
                    <p className="text-xs text-red-500 mt-0.5">{errors.lines[index]?.unitPriceNaira?.message}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={fields.length === 1}
                  className="mt-1 flex h-9 w-9 items-center justify-center rounded-md text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => append({ productId: "", quantity: 1, unitPriceNaira: 0 })}
              className="flex items-center gap-1.5 text-sm text-violet-700 hover:text-violet-800 font-medium"
            >
              <Plus className="h-4 w-4" /> Add line
            </button>
            {errors.lines?.root && (
              <p className="text-xs text-red-500">{errors.lines.root.message}</p>
            )}
          </div>

          {/* Payment */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Payment method</Label>
              <select className={SELECT_CLASS} {...register("paymentMethod")}>
                <option value="">Not specified</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Payment status</Label>
              <select className={SELECT_CLASS} {...register("paymentStatus")}>
                <option value="unpaid">On account (unpaid)</option>
                <option value="paid">Paid now</option>
              </select>
            </div>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <textarea
              id="note"
              rows={2}
              placeholder="Optional order note…"
              className="flex w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 disabled:opacity-50 resize-none"
              {...register("note")}
            />
          </div>

          {/* Total */}
          <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-3">
            <span className="text-sm text-neutral-600">Order total</span>
            <span className="text-base font-semibold text-neutral-900">{formatNaira(Math.round(grandTotal * 100))}</span>
          </div>

          {paymentStatus === "paid" && (
            <p className="text-xs text-emerald-700 bg-emerald-50 rounded-md px-3 py-2">
              Marking as Paid. Amount paid will be set to the order total.
            </p>
          )}

          {submitError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{submitError}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create order"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Main client component ─────────────────────────────────────────────────────

export function FulfilmentClient({ orders, products, role, hasBranch }: Props) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [, startTransition] = useTransition()

  const canCreate = hasBranch
  const isManager = role === "owner" || role === "admin" || role === "inventory"

  const filtered = statusFilter === "all"
    ? orders
    : orders.filter((o) => o.status === statusFilter)

  function handleSuccess() {
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <PackageCheck className="h-5 w-5 text-neutral-400" />
          <h1 className="text-lg font-semibold text-neutral-900">Fulfilment</h1>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
            {orders.length}
          </span>
        </div>
        {canCreate && (
          <Button onClick={() => setDialogOpen(true)} size="sm">
            <Plus className="mr-1.5 h-4 w-4" /> New order
          </Button>
        )}
      </div>

      {!hasBranch && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Select a branch to view and create fulfilment orders.
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-1 border-b border-neutral-200">
        {STATUS_FILTERS.map((f) => {
          const count = f === "all" ? orders.length : orders.filter((o) => o.status === f).length
          return (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                statusFilter === f
                  ? "border-violet-700 text-violet-700"
                  : "border-transparent text-neutral-500 hover:text-neutral-700"
              }`}
            >
              {f} {count > 0 && <span className="ml-1 text-xs text-neutral-400">({count})</span>}
            </button>
          )
        })}
      </div>

      {/* Orders table */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <PackageCheck className="mx-auto h-8 w-8 text-neutral-300" />
          <p className="mt-3 text-sm text-neutral-500">
            {statusFilter === "all" ? "No fulfilment orders yet." : `No ${statusFilter} orders.`}
          </p>
          {canCreate && statusFilter === "all" && (
            <Button onClick={() => setDialogOpen(true)} variant="outline" size="sm" className="mt-4">
              Create first order
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50 text-left">
                <th className="px-4 py-3 font-medium text-neutral-500">Distributor</th>
                <th className="px-4 py-3 font-medium text-neutral-500">Status</th>
                <th className="px-4 py-3 font-medium text-neutral-500 text-right">Total</th>
                <th className="px-4 py-3 font-medium text-neutral-500">Payment</th>
                {isManager && (
                  <th className="px-4 py-3 font-medium text-neutral-500">Requested by</th>
                )}
                <th className="px-4 py-3 font-medium text-neutral-500">Date</th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => router.push(`/fulfilment/${order.id}`)}
                  className="cursor-pointer hover:bg-neutral-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-900">{order.distributorName}</p>
                    {order.distributorPhone && (
                      <p className="text-xs text-neutral-400">{order.distributorPhone}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-neutral-900">
                    {formatNaira(order.totalCents)}
                  </td>
                  <td className="px-4 py-3">
                    <PaymentBadge status={order.paymentStatus} />
                  </td>
                  {isManager && (
                    <td className="px-4 py-3 text-neutral-500">{order.requestedByLabel}</td>
                  )}
                  <td className="px-4 py-3 text-neutral-500">
                    {new Date(order.createdAt).toLocaleDateString("en-NG", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="h-4 w-4 text-neutral-300" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateOrderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        products={products}
        onSuccess={handleSuccess}
      />
    </div>
  )
}
