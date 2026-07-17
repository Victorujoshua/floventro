"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ShoppingCart, Wallet, Sparkles } from "lucide-react"
import Link from "next/link"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RecordSaleDialog } from "@/components/app/sales/record-sale-dialog"
import { RecordServiceDialog } from "@/components/app/dialogs/record-service-dialog"
import type { MyHolding } from "@/lib/db/queries/holdings"

type Props = {
  holdings: MyHolding[]
}

export function HoldingClient({ holdings }: Props) {
  const router = useRouter()
  const [sellProductId, setSellProductId] = useState<string | undefined>(undefined)
  const [saleOpen, setSaleOpen] = useState(false)
  const [serviceProductId, setServiceProductId] = useState<string | undefined>(undefined)
  const [serviceOpen, setServiceOpen] = useState(false)

  function openSell(productId?: string) {
    setSellProductId(productId)
    setSaleOpen(true)
  }

  function openService(productId?: string) {
    setServiceProductId(productId)
    setServiceOpen(true)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">My Holding</h1>
          <p className="text-sm text-neutral-500 mt-1">Stock issued to you that you can sell or use</p>
        </div>
        {holdings.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => openService(undefined)}
              className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 h-10 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              Record service
            </button>
            <button
              onClick={() => openSell(undefined)}
              className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
            >
              <ShoppingCart className="h-4 w-4" />
              New sale
            </button>
          </div>
        )}
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
        <div className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50">
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">SKU</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Product</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Branch</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Held</TableHead>
                <TableHead className="w-24" />
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
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => openService(h.productId)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-3 h-7 text-xs font-medium text-neutral-700 hover:bg-neutral-200 transition-colors"
                      >
                        <Sparkles className="h-3 w-3" />
                        Service
                      </button>
                      <button
                        onClick={() => openSell(h.productId)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-violet-50 px-3 h-7 text-xs font-medium text-violet-700 hover:bg-violet-100 transition-colors"
                      >
                        <ShoppingCart className="h-3 w-3" />
                        Sell
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <RecordSaleDialog
        open={saleOpen}
        onOpenChange={(o) => { if (!o) { setSaleOpen(false); setSellProductId(undefined) } }}
        onSuccess={() => router.refresh()}
        initialProductId={sellProductId}
      />

      <RecordServiceDialog
        open={serviceOpen}
        onOpenChange={(o) => { if (!o) { setServiceOpen(false); setServiceProductId(undefined) } }}
        onSuccess={() => router.refresh()}
        initialProductId={serviceProductId}
      />
    </div>
  )
}
