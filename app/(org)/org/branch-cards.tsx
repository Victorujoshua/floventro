"use client"

import { useState } from "react"
import { LogIn } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatNaira } from "@/lib/format/money"
import { enterBranchAction } from "@/lib/db/actions/org"
import type { BranchSummary } from "@/lib/db/queries/org"

export function BranchCards({ branches }: { branches: BranchSummary[] }) {
  const [enteringId, setEnteringId] = useState<string | null>(null)

  async function handleEnter(branchId: string) {
    if (enteringId) return
    setEnteringId(branchId)
    const result = await enterBranchAction(branchId)
    if (result.ok) {
      window.location.href = "/dashboard"
    } else {
      setEnteringId(null)
    }
  }

  if (branches.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No branches yet.{" "}
        <a href="/admin/branches" className="underline underline-offset-4 hover:text-neutral-700">
          Add one →
        </a>
      </p>
    )
  }

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {branches.map((b) => (
        <div
          key={b.id}
          className="bg-white rounded-2xl border border-neutral-200/60 p-5 flex flex-col gap-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-950 truncate">{b.name}</p>
              {b.address && (
                <p className="text-xs text-neutral-400 mt-0.5 truncate">{b.address}</p>
              )}
            </div>
            <button
              onClick={() => handleEnter(b.id)}
              disabled={enteringId !== null}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 h-8 text-xs font-medium transition-colors",
                enteringId === b.id
                  ? "text-violet-700 border-violet-200 bg-tint-violet"
                  : "text-neutral-600 border-neutral-200 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              <LogIn className="h-3.5 w-3.5" />
              {enteringId === b.id ? "Entering…" : "Enter"}
            </button>
          </div>

          <div className="flex gap-5 pt-1 border-t border-neutral-100">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-neutral-400">Revenue (30d)</p>
              <p className="text-sm font-mono tabular-nums text-neutral-800 mt-0.5">
                <span className="font-inter">₦</span>
                {formatNaira(b.revenueLast30dCents)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-neutral-400">Stock</p>
              <p className="text-sm font-mono tabular-nums text-neutral-800 mt-0.5">
                {b.stockUnits.toLocaleString()} units
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
