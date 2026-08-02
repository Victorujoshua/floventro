"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Wallet, Undo2 } from "lucide-react"
import Link from "next/link"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ReturnToBranchDialog } from "@/components/app/dialogs/return-to-branch-dialog"
import type { MyHolding, ProductHoldingHistory } from "@/lib/db/queries/holdings"

type Props = {
  holdings: MyHolding[]
  history: ProductHoldingHistory[]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export function HoldingClient({ holdings, history }: Props) {
  const totalUnits = holdings.reduce((sum, h) => sum + h.quantity, 0)
  const productCount = new Set(holdings.map((h) => h.productId)).size
  const router = useRouter()

  const [returnHolding, setReturnHolding] = useState<MyHolding | null>(null)
  const [returnOpen, setReturnOpen] = useState(false)

  function openReturn(h: MyHolding) {
    setReturnHolding(h)
    setReturnOpen(true)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">My Holding</h1>
          <p className="text-sm text-neutral-500 mt-1">Stock issued to you that you can sell or use</p>
        </div>
      </div>

      {holdings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center px-6">
          <Wallet className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No stock in your holding</p>
          <p className="text-sm text-neutral-500 mt-1 max-w-sm">
            Request stock from the inventory team and it will appear here once approved.
          </p>
          <Link
            href="/requests"
            className="mt-4 inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 h-9 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            Request stock
          </Link>
        </div>
      ) : (
        <>
          {/* Total units stat strip */}
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-neutral-200/60 bg-neutral-50 px-5 py-3">
            <p className="text-sm font-semibold text-neutral-950 tabular-nums">
              {totalUnits.toLocaleString()} units
            </p>
            <span className="text-neutral-300">·</span>
            <p className="text-sm text-neutral-500">
              {productCount} product{productCount !== 1 ? "s" : ""} in holding
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50">
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">SKU</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Product</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Branch</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Held</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {holdings.map((h) => (
                <TableRow key={`${h.branchId}-${h.productId}`} className="hover:bg-neutral-50/60 transition-colors">
                  <TableCell className="font-mono text-sm tabular-nums text-neutral-500 py-3.5">
                    {h.productSku}
                  </TableCell>
                  <TableCell className="text-sm font-medium text-neutral-950 py-3.5">
                    {h.productName}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-500 py-3.5">
                    {h.branchName}
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums text-neutral-950 py-3.5 text-right">
                    {h.quantity}
                  </TableCell>
                  <TableCell className="py-3.5 text-right">
                    <button
                      onClick={() => openReturn(h)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-7 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
                    >
                      <Undo2 className="h-3 w-3" />
                      Return
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}

      {/* Movement history — per-product, newest first */}
      {history.length > 0 && (
        <div className="mt-6 space-y-5">
          <h2 className="text-base font-semibold text-neutral-950">Movement history</h2>
          {history.map((product) => (
            <div key={product.productId} className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
              <div className="px-6 py-4 border-b border-neutral-100">
                <p className="text-sm font-semibold text-neutral-950">{product.productName}</p>
                {product.productSku && (
                  <p className="text-xs font-mono text-neutral-500 mt-0.5">{product.productSku}</p>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 bg-neutral-50">
                      <th className="px-6 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">Date</th>
                      <th className="px-6 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">Movement</th>
                      <th className="px-6 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide">Change</th>
                      <th className="px-6 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {product.movements.map((mv) => (
                      <tr key={mv.id} className="hover:bg-neutral-50/60 transition-colors">
                        <td className="px-6 py-3 text-sm text-neutral-500 whitespace-nowrap">
                          {formatDate(mv.createdAt)}
                        </td>
                        <td className="px-6 py-3">
                          <p className="text-sm text-neutral-950">{mv.movementLabel}</p>
                          {mv.note && <p className="text-xs text-neutral-400 mt-0.5">{mv.note}</p>}
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className={`font-mono tabular-nums text-sm font-medium ${mv.quantityDelta > 0 ? "text-green-600" : "text-red-600"}`}>
                            {mv.quantityDelta > 0 ? `+${mv.quantityDelta}` : `${mv.quantityDelta}`}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <span className="font-mono tabular-nums text-sm text-neutral-500">
                            {mv.balanceBefore.toLocaleString()} → {mv.balanceAfter.toLocaleString()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <ReturnToBranchDialog
        open={returnOpen}
        onOpenChange={(o) => { if (!o) setReturnOpen(false) }}
        onSuccess={() => router.refresh()}
        holding={returnHolding}
      />
    </div>
  )
}
