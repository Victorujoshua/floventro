"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, Trash2, ArrowLeft } from "lucide-react"
import { addServiceConsumptionAction } from "@/lib/db/actions/services"
import type { MyHolding } from "@/lib/db/queries/holdings"

type Line = { productId: string; quantity: number }

type Props = {
  recordId: string
  serviceTypeName: string
  customerName: string | null
  performedOn: string
  holdings: MyHolding[]
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function AddItemsClient({
  recordId,
  serviceTypeName,
  customerName,
  performedOn,
  holdings,
}: Props) {
  const router = useRouter()
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: 1 }])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    const valid = lines.filter((l) => l.productId && l.quantity > 0)
    if (valid.length === 0) {
      setError("Add at least one product with a valid quantity.")
      return
    }
    setSubmitting(true)
    setError(null)
    const res = await addServiceConsumptionAction(recordId, valid)
    setSubmitting(false)
    if (!res.ok) {
      setError(res.message ?? "Something went wrong.")
      return
    }
    router.push("/services-performed")
  }

  return (
    <div className="max-w-xl">
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
        Record which products were consumed during this session.
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

      {holdings.length === 0 ? (
        <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-700">
            You have no items in your holding. Receive stock into your holding first.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select
                  value={line.productId}
                  onChange={(e) => {
                    const next = [...lines]
                    next[idx] = { ...next[idx], productId: e.target.value }
                    setLines(next)
                  }}
                  className="flex-1 h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-950 focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="">Select product…</option>
                  {holdings.map((h) => (
                    <option key={h.productId} value={h.productId}>
                      {h.productName} ({h.productSku}) — {h.quantity} in hand
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(e) => {
                    const next = [...lines]
                    next[idx] = { ...next[idx], quantity: parseInt(e.target.value, 10) || 1 }
                    setLines(next)
                  }}
                  className="w-20 h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-950 text-center focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                    className="p-1.5 text-neutral-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setLines([...lines, { productId: "", quantity: 1 }])}
            className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add another item
          </button>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center gap-4 pt-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
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
        </div>
      )}
    </div>
  )
}
