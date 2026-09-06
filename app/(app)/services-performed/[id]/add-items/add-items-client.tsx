"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Plus } from "lucide-react"
import { toast } from "sonner"
import { addServiceItemConsumptionAction } from "@/lib/db/actions/services"

export type ServiceItemEntry = {
  id: string
  name: string
  category: "product" | "supply" | "equipment"
  amountCents: number
  packageSize: number | null
  measurementName: string | null
  measurementSymbol: string | null
}

type CategoryFilter = "all" | "product" | "supply" | "equipment"

type Props = {
  recordId: string
  serviceTypeName: string
  customerName: string | null
  performedOn: string
  createdAt: string
  serviceItems: ServiceItemEntry[]
}

const FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: "all",       label: "All" },
  { value: "product",   label: "Product" },
  { value: "supply",    label: "Supply" },
  { value: "equipment", label: "Others" },
]

function formatDate(dateStr: string, timeStr: string) {
  const date = new Date(dateStr).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
  const time = new Date(timeStr).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  })
  return `${date}, ${time}`
}

function fmtNaira(cents: number) {
  return (cents / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function AddItemsClient({
  recordId,
  serviceTypeName,
  customerName,
  performedOn,
  createdAt,
  serviceItems,
}: Props) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all")
  const [search, setSearch] = useState("")
  const [itemAmounts, setItemAmounts] = useState<Record<string, string>>({})
  const [itemState, setItemState] = useState<Record<string, "idle" | "loading" | "done" | "error">>({})
  const [itemError, setItemError] = useState<Record<string, string>>({})

  const filtered = serviceItems.filter((i) => {
    const matchesCategory = categoryFilter === "all" || i.category === categoryFilter
    const matchesSearch   = search === "" || i.name.toLowerCase().includes(search.toLowerCase())
    return matchesCategory && matchesSearch
  })

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
        Record service items used during this session.
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
          <span className="text-neutral-950">{formatDate(performedOn, createdAt)}</span>
        </div>
      </div>

      {serviceItems.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 px-4 py-6 text-center">
          <p className="text-sm text-neutral-500">No service items configured for this organisation.</p>
        </div>
      ) : (
        <div>
          {/* Category filter */}
          <div className="flex items-center gap-1 mb-3">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setCategoryFilter(f.value)}
                className={`rounded-md px-3 h-8 text-xs font-medium transition-colors ${
                  categoryFilter === f.value
                    ? "bg-violet-700 text-white"
                    : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-500 mb-4"
          />

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-neutral-200 px-4 py-6 text-center">
              <p className="text-sm text-neutral-500">No items match your filter.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
              {filtered.map((item) => {
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
          )}
        </div>
      )}
    </div>
  )
}
