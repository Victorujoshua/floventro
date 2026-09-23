import { cn } from "@/lib/utils"
import { formatNaira } from "@/lib/format/money"
import type { RevenueSplit } from "@/lib/db/queries/revenue-split"

// Shared description line for every Revenue card: "₦X paid at sale · ₦Y on credit".
export function RevenueSplitNote({ split, className }: { split: RevenueSplit; className?: string }) {
  return (
    <p className={cn("text-xs text-neutral-500 mt-1 tabular-nums", className)}>
      <span className="font-inter">₦</span>{formatNaira(split.paidAtSaleCents)} paid at sale
      {" · "}
      <span className="font-inter">₦</span>{formatNaira(split.creditCents)} on credit
    </p>
  )
}
