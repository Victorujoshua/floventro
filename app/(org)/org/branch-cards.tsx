"use client"

import { useRef, useState, type KeyboardEvent } from "react"
import { LogIn } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { formatNaira } from "@/lib/format/money"
import { enterBranchAction } from "@/lib/db/actions/org"
import { RevenueSplitNote } from "@/components/app/revenue-split-note"
import { CARD_LINK_INTERACTION } from "@/components/app/card-link"
import type { BranchSummary } from "@/lib/db/queries/org"

export function BranchCards({ branches }: { branches: BranchSummary[] }) {
  const [enteringId, setEnteringId] = useState<string | null>(null)
  // State alone can't stop a second click that lands before React re-renders;
  // the ref flips synchronously, so only the first click starts the action.
  const inFlight = useRef(false)

  async function handleEnter(branchId: string) {
    if (inFlight.current) return
    inFlight.current = true
    setEnteringId(branchId)

    let ok = false
    try {
      ok = (await enterBranchAction(branchId)).ok
    } catch (err) {
      console.error("[BranchCards] enterBranchAction", err)
    }

    if (ok) {
      // Full navigation so the new branch scope cookie is picked up everywhere.
      // Leave inFlight set — the page is unloading.
      window.location.href = "/dashboard"
      return
    }

    inFlight.current = false
    setEnteringId(null)
    toast.error("Couldn't enter that branch — please try again.")
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>, branchId: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      handleEnter(branchId)
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
      {branches.map((b) => {
        const isEntering = enteringId === b.id
        const isBlocked = enteringId !== null
        return (
          // Whole card enters the branch. A div with role="button" rather than a
          // <button>, because the card contains block content (<p>, <div>).
          <div
            key={b.id}
            role="button"
            tabIndex={isBlocked ? -1 : 0}
            aria-label={`Enter ${b.name}`}
            aria-busy={isEntering}
            aria-disabled={isBlocked}
            onClick={() => handleEnter(b.id)}
            onKeyDown={(e) => handleKeyDown(e, b.id)}
            className={cn(
              // Shared interaction first so this card's `flex` wins over its `block`.
              CARD_LINK_INTERACTION,
              "bg-white rounded-2xl border border-neutral-200/60 p-5 flex flex-col gap-3",
              isEntering && "border-violet-200 cursor-wait",
              isBlocked && !isEntering && "opacity-50 cursor-not-allowed pointer-events-none",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-950 truncate">{b.name}</p>
              </div>
              {/* Visual cue only — the card itself handles the click. */}
              <span
                aria-hidden
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 h-8 text-xs font-medium transition-colors",
                  isEntering
                    ? "text-violet-700 border-violet-200 bg-tint-violet"
                    : "text-neutral-600 border-neutral-200 group-hover:bg-neutral-50",
                )}
              >
                <LogIn className="h-3.5 w-3.5" />
                {isEntering ? "Entering…" : "Enter"}
              </span>
            </div>

            <div className="flex gap-5 pt-1 border-t border-neutral-100">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-400">Revenue (30d)</p>
                <p className="text-sm font-mono tabular-nums text-neutral-800 mt-0.5">
                  <span className="font-inter">₦</span>
                  {formatNaira(b.revenueLast30dCents)}
                </p>
                <RevenueSplitNote split={b.revenueLast30dSplit} className="text-[11px] text-neutral-400 mt-0.5" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-400">Stock</p>
                <p className="text-sm font-mono tabular-nums text-neutral-800 mt-0.5">
                  {b.stockUnits.toLocaleString()} units
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
