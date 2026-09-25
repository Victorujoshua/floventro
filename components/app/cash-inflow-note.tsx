import { cn } from "@/lib/utils"
import { formatNaira } from "@/lib/format/money"
import type { CashInflow } from "@/lib/db/queries/cash-inflow"

// Shared description line for every Cash inflow card: "₦X at till · ₦Y later payments".
export function CashInflowNote({ cash, className }: { cash: CashInflow; className?: string }) {
  return (
    <p className={cn("text-xs text-neutral-500 mt-1 tabular-nums", className)}>
      <span className="font-inter">₦</span>{formatNaira(cash.tillCents)} at till
      {" · "}
      <span className="font-inter">₦</span>{formatNaira(cash.laterPaymentsCents)} later payments
    </p>
  )
}
