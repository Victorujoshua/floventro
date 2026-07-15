"use client"

import { useState, useMemo } from "react"
import { Users, ChevronDown, ChevronRight, Package } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { HolderGroup } from "@/lib/db/queries/holdings"

type Props = {
  groups: HolderGroup[]
}

export function HoldingsOverviewClient({ groups }: Props) {
  const [search, setSearch] = useState("")
  const [expandedHolders, setExpandedHolders] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return groups
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (item) =>
            item.productName.toLowerCase().includes(q) ||
            item.productSku.toLowerCase().includes(q)
        ),
      }))
      .filter(
        (g) =>
          g.items.length > 0 ||
          (g.holderName || g.holderEmail).toLowerCase().includes(q)
      )
  }, [groups, search])

  function toggleHolder(uid: string) {
    setExpandedHolders((prev) => {
      const next = new Set(prev)
      next.has(uid) ? next.delete(uid) : next.add(uid)
      return next
    })
  }

  const totalUnits = groups.reduce((sum, g) => sum + g.items.reduce((s, i) => s + i.quantity, 0), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Staff holdings</h1>
          <p className="text-sm text-neutral-500 mt-1">Stock currently held by your team</p>
        </div>
        {totalUnits > 0 && (
          <div className="rounded-lg bg-tint-violet px-4 py-2 text-sm text-violet-700 font-medium tabular-nums">
            {totalUnits} units out
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center px-6">
          <Users className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No stock held by staff</p>
          <p className="text-sm text-neutral-500 mt-1">
            Stock will appear here once requests are approved and issued.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4">
            <Input
              placeholder="Search by product or staff name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm rounded-lg"
            />
          </div>

          <div className="space-y-3">
            {filtered.map((group) => {
              const isExpanded = expandedHolders.has(group.holderUserId)
              const holderLabel = group.holderName || group.holderEmail
              const groupTotal = group.items.reduce((s, i) => s + i.quantity, 0)

              return (
                <div key={group.holderUserId} className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
                  {/* Holder header */}
                  <button
                    type="button"
                    onClick={() => toggleHolder(group.holderUserId)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-neutral-50/60 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700">
                        {(group.holderName || group.holderEmail).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-neutral-950">{holderLabel}</p>
                        {group.holderName && (
                          <p className="text-xs text-neutral-400">{group.holderEmail}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium tabular-nums text-neutral-500">
                        {group.items.length} product{group.items.length !== 1 ? "s" : ""} · {groupTotal} units
                      </span>
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-neutral-400" />
                        : <ChevronRight className="h-4 w-4 text-neutral-400" />
                      }
                    </div>
                  </button>

                  {/* Items */}
                  {isExpanded && (
                    <div className="border-t border-neutral-100">
                      {group.items.map((item) => (
                        <div
                          key={item.productId}
                          className="flex items-center justify-between px-5 py-3 border-b border-neutral-50 last:border-b-0 hover:bg-neutral-50/40"
                        >
                          <div className="flex items-center gap-3">
                            <Package className="h-3.5 w-3.5 text-neutral-300 shrink-0" />
                            <div>
                              <p className="text-sm text-neutral-950">{item.productName}</p>
                              <p className="text-xs font-mono text-neutral-400">{item.productSku}</p>
                            </div>
                          </div>
                          <span className="text-sm font-mono tabular-nums font-medium text-neutral-950">
                            {item.quantity}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {filtered.length === 0 && (
              <div className="rounded-2xl border border-neutral-200/60 bg-white py-12 text-center">
                <p className="text-sm text-neutral-500">No results match your search.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
