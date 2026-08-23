"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, PackagePlus, Plus } from "lucide-react"
import { toast } from "sonner"
import { addServiceConsumptionAction, addServiceItemConsumptionAction } from "@/lib/db/actions/services"
import { createRequestAction } from "@/lib/db/actions/requests"

export type CatalogItem = {
  productId: string
  productName: string
  productSku: string
  holdingQty: number
}

export type ServiceItemEntry = {
  id: string
  name: string
  category: "product" | "supply" | "equipment"
  amountCents: number
  packageSize: number | null
  measurementName: string | null
  measurementSymbol: string | null
}

type Props = {
  recordId: string
  serviceTypeName: string
  customerName: string | null
  performedOn: string
  catalog: CatalogItem[]
  serviceItems: ServiceItemEntry[]
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function fmtNaira(cents: number) {
  return (cents / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function AddItemsClient({
  recordId,
  serviceTypeName,
  customerName,
  performedOn,
  catalog,
  serviceItems,
}: Props) {
  const router = useRouter()

  // Product-holdings state
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [reqQtys, setReqQtys] = useState<Record<string, string>>({})
  const [reqState, setReqState] = useState<Record<string, "idle" | "loading" | "done">>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Service-items state
  const [itemAmounts, setItemAmounts] = useState<Record<string, string>>({})
  const [itemState, setItemState] = useState<Record<string, "idle" | "loading" | "done" | "error">>({})
  const [itemError, setItemError] = useState<Record<string, string>>({})

  const heldItems = catalog.filter((i) => i.holdingQty > 0)
  const notHeldItems = catalog.filter((i) => i.holdingQty === 0)

  function setQty(productId: string, val: string) {
    setQtys((prev) => ({ ...prev, [productId]: val }))
  }

  async function handleRequest(productId: string) {
    const qty = Math.max(1, parseInt(reqQtys[productId] ?? "1", 10) || 1)
    setReqState((prev) => ({ ...prev, [productId]: "loading" }))
    const res = await createRequestAction({ lines: [{ productId, quantity: qty }] })
    if (!res.ok) {
      setReqState((prev) => ({ ...prev, [productId]: "idle" }))
      toast.error(res.message ?? "Could not create request.")
      return
    }
    setReqState((prev) => ({ ...prev, [productId]: "done" }))
    toast.success(`Stock requested (${qty} unit${qty !== 1 ? "s" : ""}) — inventory will issue it to your holding.`)
  }

  async function handleSubmit() {
    const lines = heldItems.flatMap((item) => {
      const q = parseInt(qtys[item.productId] ?? "0", 10)
      if (!q || q <= 0) return []
      return [{ productId: item.productId, quantity: Math.min(q, item.holdingQty) }]
    })

    if (lines.length === 0) {
      setError("Enter a quantity for at least one held product.")
      return
    }

    setSubmitting(true)
    setError(null)
    const res = await addServiceConsumptionAction(recordId, lines)
    setSubmitting(false)
    if (!res.ok) {
      setError(res.message ?? "Something went wrong.")
      return
    }
    router.push("/services-performed")
  }

  async function handleAddServiceItem(item: ServiceItemEntry) {
    const isFlatRate = item.category === "equipment" || item.packageSize == null
    let amountUsed: number | null = null

    if (!isFlatRate) {
      const raw = itemAmounts[item.id] ?? ""
      amountUsed = parseFloat(raw)
      if (!raw || isNaN(amountUsed) || amountUsed <= 0) {
        setItemError((prev) => ({ ...prev, [item.id]: "Enter an amount greater than 0." }))
        return
      }
    }

    setItemState((prev) => ({ ...prev, [item.id]: "loading" }))
    setItemError((prev) => ({ ...prev, [item.id]: "" }))

    const res = await addServiceItemConsumptionAction(recordId, [{ serviceItemId: item.id, amountUsed }])

    if (!res.ok) {
      setItemState((prev) => ({ ...prev, [item.id]: "error" }))
      setItemError((prev) => ({ ...prev, [item.id]: res.message ?? "Something went wrong." }))
      return
    }
    setItemState((prev) => ({ ...prev, [item.id]: "done" }))
    toast.success(`${item.name} recorded.`)
  }

  const hasAnyQty = heldItems.some((i) => parseInt(qtys[i.productId] ?? "0", 10) > 0)

  return (
    <div className="max-w-2xl">
      <Link
        href="/services-performed"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800 transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Services performed
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-neutral-950 mb-1">
        Add items used
      </h1>
      <p className="text-sm text-neutral-500 mb-6">
        Record product holdings consumed and service items used during this session.
      </p>

      {/* Session context */}
      <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 space-y-1.5 mb-6">
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">Service</span>
          <span className="font-medium text-neutral-950">{serviceTypeName}</span>
        </div>
        {customerName && (
          <div className="flex justify-between text-sm">
            <span className="text-neutral-500">For</span>
            <span className="text-neutral-950">{customerName}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">Date</span>
          <span className="text-neutral-950">{formatDate(performedOn)}</span>
        </div>
      </div>

      <div className="space-y-8">
        {/* ── Product holdings ─────────────────────────────────────────────── */}
        {catalog.length > 0 && (
          <div className="space-y-6">
            {heldItems.length > 0 && (
              <div>
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-3">
                  In your holding — enter quantity used
                </p>
                <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
                  {heldItems.map((item) => {
                    const val = qtys[item.productId] ?? ""
                    const parsed = parseInt(val, 10)
                    const overMax = !!val && parsed > item.holdingQty
                    return (
                      <div key={item.productId} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-neutral-950 truncate">{item.productName}</p>
                          <p className="text-xs font-mono text-neutral-400">{item.productSku}</p>
                        </div>
                        <span className="text-xs text-neutral-500 whitespace-nowrap shrink-0">
                          {item.holdingQty} in hand
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={item.holdingQty}
                          value={val}
                          placeholder="0"
                          onChange={(e) => setQty(item.productId, e.target.value)}
                          className={`w-20 h-9 rounded-md border px-3 text-sm text-neutral-950 text-center focus:outline-none focus:ring-2 ${
                            overMax
                              ? "border-red-300 bg-red-50 focus:ring-red-400"
                              : "border-neutral-200 bg-white focus:ring-violet-500"
                          }`}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {notHeldItems.length > 0 && (
              <div>
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-3">
                  Not in your holding — request from inventory
                </p>
                <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
                  {notHeldItems.map((item) => {
                    const state = reqState[item.productId] ?? "idle"
                    const reqQty = reqQtys[item.productId] ?? "1"
                    return (
                      <div key={item.productId} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-neutral-950 truncate">{item.productName}</p>
                          <p className="text-xs font-mono text-neutral-400">{item.productSku}</p>
                        </div>
                        <span className="text-xs text-neutral-400 whitespace-nowrap shrink-0">0 in hand</span>
                        {state === "done" ? (
                          <span className="text-xs font-medium text-emerald-600 px-2.5 h-8 inline-flex items-center shrink-0">
                            Requested ✓
                          </span>
                        ) : (
                          <>
                            <input
                              type="number"
                              min={1}
                              value={reqQty}
                              disabled={state === "loading"}
                              onChange={(e) =>
                                setReqQtys((prev) => ({ ...prev, [item.productId]: e.target.value }))
                              }
                              className="w-16 h-8 rounded-md border border-neutral-200 bg-white px-2 text-sm text-neutral-950 text-center focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
                            />
                            <button
                              type="button"
                              disabled={state === "loading"}
                              onClick={() => handleRequest(item.productId)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 h-8 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors shrink-0"
                            >
                              <PackagePlus className="h-3.5 w-3.5" />
                              {state === "loading" ? "Requesting…" : "Request"}
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {heldItems.length === 0 && (
              <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
                <p className="text-sm text-amber-700">
                  You have no items in your holding. Request the products you need above — once inventory issues them they{"'"}ll appear here to consume.
                </p>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            {heldItems.length > 0 && (
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || !hasAnyQty}
                  className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-5 h-10 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50 transition-colors"
                >
                  {submitting ? "Recording…" : "Record items used"}
                </button>
                <Link
                  href="/services-performed"
                  className="text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
                >
                  Cancel
                </Link>
              </div>
            )}
          </div>
        )}

        {/* ── Service items ─────────────────────────────────────────────────── */}
        {serviceItems.length > 0 && (
          <div>
            <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-3">
              Service items — record by catalog cost
            </p>
            <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
              {serviceItems.map((item) => {
                const isFlatRate = item.category === "equipment" || item.packageSize == null
                const sym = item.measurementSymbol ?? item.measurementName ?? "unit"
                const costHint = isFlatRate
                  ? `₦${fmtNaira(item.amountCents)} flat`
                  : `₦${fmtNaira(item.amountCents)} / ${item.packageSize} ${sym}`
                const state = itemState[item.id] ?? "idle"

                return (
                  <div key={item.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-neutral-950 truncate">{item.name}</p>
                        <p className="text-xs font-mono text-neutral-400">{costHint}</p>
                      </div>
                      {state === "done" ? (
                        <span className="text-xs font-medium text-emerald-600 px-2.5 h-8 inline-flex items-center shrink-0">
                          Recorded ✓
                        </span>
                      ) : (
                        <>
                          {!isFlatRate && (
                            <input
                              type="number"
                              min={0.01}
                              step="any"
                              value={itemAmounts[item.id] ?? ""}
                              placeholder={`0 ${sym}`}
                              disabled={state === "loading"}
                              onChange={(e) =>
                                setItemAmounts((prev) => ({ ...prev, [item.id]: e.target.value }))
                              }
                              className="w-24 h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-950 text-center focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
                            />
                          )}
                          <button
                            type="button"
                            disabled={state === "loading"}
                            onClick={() => handleAddServiceItem(item)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 h-8 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors shrink-0"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            {state === "loading" ? "Recording…" : "Record"}
                          </button>
                        </>
                      )}
                    </div>
                    {itemError[item.id] && (
                      <p className="text-xs text-red-600 mt-1.5">{itemError[item.id]}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {catalog.length === 0 && serviceItems.length === 0 && (
          <div className="rounded-lg border border-neutral-200 px-4 py-6 text-center">
            <p className="text-sm text-neutral-500">No products or service items configured for this organisation.</p>
          </div>
        )}
      </div>
    </div>
  )
}
