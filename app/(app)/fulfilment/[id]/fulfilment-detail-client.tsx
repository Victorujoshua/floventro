"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Package } from "lucide-react"
import { toast } from "sonner"
import {
  packFulfilmentOrderAction,
  shipFulfilmentOrderAction,
  deliverFulfilmentOrderAction,
  cancelFulfilmentOrderAction,
} from "@/lib/db/actions/fulfilment"
import type { FulfilmentOrder } from "@/lib/db/queries/fulfilment"
import type { Role } from "@/lib/auth/scope"
import { formatNaira } from "@/lib/format/money"
import { StatusBadge } from "../fulfilment-client"
import { Button } from "@/components/ui/button"

type Props = {
  order: FulfilmentOrder
  role: Role
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash:          "Cash",
  pos:           "POS",
  bank_transfer: "Bank transfer",
  cheque:        "Cheque",
  other:         "Other",
}

function TimelineRow({ label, actor, at }: { label: string; actor: string | null; at: string | null }) {
  if (!at) return null
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-violet-500" />
      <div>
        <p className="text-sm font-medium text-neutral-800">{label}</p>
        <p className="text-xs text-neutral-400">
          {new Date(at).toLocaleString("en-NG", {
            day: "numeric", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit",
          })}
          {actor && ` · ${actor}`}
        </p>
      </div>
    </div>
  )
}

export function FulfilmentDetailClient({ order, role }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [actionError, setActionError] = useState<string | null>(null)

  const isManager = role === "owner" || role === "admin" || role === "inventory"

  async function runAction(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setActionError(null)
    const result = await fn()
    if (!result.ok) {
      setActionError(result.message ?? "Something went wrong")
      return
    }
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-6 p-6 max-w-3xl">
      {/* Back */}
      <button
        onClick={() => router.push("/fulfilment")}
        className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to orders
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-lg font-semibold text-neutral-900">{order.distributorName}</h1>
            <StatusBadge status={order.status} />
          </div>
          <p className="text-sm text-neutral-500">
            {order.distributorPhone && <span>{order.distributorPhone}</span>}
            {order.distributorPhone && order.distributorEmail && <span> · </span>}
            {order.distributorEmail && <span>{order.distributorEmail}</span>}
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            Requested by {order.requestedByLabel} on{" "}
            {new Date(order.createdAt).toLocaleDateString("en-NG", {
              day: "numeric", month: "short", year: "numeric",
            })}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isManager && order.status === "pending" && (
            <Button
              size="sm"
              onClick={() => runAction(() => packFulfilmentOrderAction(order.id))}
              disabled={isPending}
            >
              Pack order
            </Button>
          )}
          {isManager && order.status === "packed" && (
            <Button
              size="sm"
              onClick={() => runAction(() => shipFulfilmentOrderAction(order.id))}
              disabled={isPending}
            >
              Mark shipped
            </Button>
          )}
          {isManager && order.status === "shipped" && (
            <Button
              size="sm"
              onClick={() => runAction(() => deliverFulfilmentOrderAction(order.id))}
              disabled={isPending}
            >
              Mark delivered
            </Button>
          )}
          {order.status === "pending" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => runAction(() => cancelFulfilmentOrderAction(order.id))}
              disabled={isPending}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {/* Lines */}
      <div className="rounded-xl border border-neutral-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100 bg-neutral-50 flex items-center gap-2">
          <Package className="h-4 w-4 text-neutral-400" />
          <h2 className="text-sm font-medium text-neutral-700">Order lines</h2>
          <span className="text-xs text-neutral-400">({order.lines.length})</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left">
              <th className="px-4 py-3 font-medium text-neutral-500">Product</th>
              <th className="px-4 py-3 font-medium text-neutral-500 text-right">Qty</th>
              <th className="px-4 py-3 font-medium text-neutral-500 text-right">Unit price</th>
              <th className="px-4 py-3 font-medium text-neutral-500 text-right">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {order.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-neutral-900">{line.productName}</p>
                  <p className="text-xs text-neutral-400">{line.productSku}</p>
                </td>
                <td className="px-4 py-3 text-right text-neutral-700">{line.quantity}</td>
                <td className="px-4 py-3 text-right text-neutral-700">{formatNaira(line.unitPriceCents)}</td>
                <td className="px-4 py-3 text-right font-medium text-neutral-900">{formatNaira(line.lineTotalCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-neutral-200 bg-neutral-50">
              <td colSpan={3} className="px-4 py-3 text-right text-sm font-medium text-neutral-700">Order total</td>
              <td className="px-4 py-3 text-right text-base font-semibold text-neutral-900">{formatNaira(order.totalCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Payment + meta */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-neutral-200 p-4 space-y-3">
          <h2 className="text-sm font-medium text-neutral-700">Payment</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-500">Status</span>
              <span className="font-medium capitalize text-neutral-900">{order.paymentStatus}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Amount paid</span>
              <span className="font-medium text-neutral-900">{formatNaira(order.amountPaidCents)}</span>
            </div>
            {order.totalCents - order.amountPaidCents > 0 && (
              <div className="flex justify-between">
                <span className="text-neutral-500">Balance due</span>
                <span className="font-medium text-red-600">{formatNaira(order.totalCents - order.amountPaidCents)}</span>
              </div>
            )}
            {order.paymentMethod && (
              <div className="flex justify-between">
                <span className="text-neutral-500">Method</span>
                <span className="text-neutral-900">{PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}</span>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 p-4 space-y-3">
          <h2 className="text-sm font-medium text-neutral-700">Timeline</h2>
          <div className="space-y-3">
            <TimelineRow
              label="Order placed"
              actor={order.requestedByLabel}
              at={order.createdAt}
            />
            <TimelineRow label="Packed"    actor={order.packedByLabel}    at={order.packedAt} />
            <TimelineRow label="Shipped"   actor={order.shippedByLabel}   at={order.shippedAt} />
            <TimelineRow label="Delivered" actor={order.deliveredByLabel} at={order.deliveredAt} />
            <TimelineRow label="Cancelled" actor={order.cancelledByLabel} at={order.cancelledAt} />
          </div>
        </div>
      </div>

      {order.note && (
        <div className="rounded-xl border border-neutral-200 p-4">
          <h2 className="text-sm font-medium text-neutral-700 mb-1">Note</h2>
          <p className="text-sm text-neutral-600">{order.note}</p>
        </div>
      )}
    </div>
  )
}
