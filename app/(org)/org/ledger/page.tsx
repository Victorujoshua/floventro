import {
  PackagePlus,
  ClipboardCheck,
  Settings2,
  ArrowDownToLine,
  RotateCcw,
  CheckCircle,
  ShoppingCart,
  Wrench,
  ArrowRight,
  ArrowLeft,
  Undo2,
  Activity,
} from "lucide-react"
import { requireOwner } from "@/lib/auth/guards"
import { getOrgLedger } from "@/lib/db/queries/org"
import type { OrgLedgerRow } from "@/lib/db/queries/org"

const REASON_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  vendor_invoice:     PackagePlus,
  request_fulfilment: ClipboardCheck,
  adjustment:         Settings2,
  issue_to_holding:   ArrowDownToLine,
  return_to_branch:   RotateCcw,
  return_receipt:     CheckCircle,
  sale:               ShoppingCart,
  usage:              Wrench,
  transfer_in:        ArrowRight,
  transfer_out:       ArrowLeft,
  reversal:           Undo2,
}

function LedgerIcon({ reason }: { reason: string }) {
  const Icon = REASON_ICON[reason] ?? Activity
  const isPositive = ["vendor_invoice", "return_receipt", "transfer_in", "return_to_branch"].includes(reason)
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
        isPositive
          ? "bg-tint-success text-green-600"
          : reason === "transfer_out" || reason === "issue_to_holding"
          ? "bg-tint-amber text-amber-600"
          : "bg-neutral-100 text-neutral-500"
      }`}
    >
      <Icon className="h-4 w-4" />
    </span>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function DeltaBadge({ delta }: { delta: number }) {
  const sign = delta > 0 ? "+" : ""
  return (
    <span
      className={`text-sm font-mono tabular-nums font-medium shrink-0 ${
        delta > 0 ? "text-green-700" : delta < 0 ? "text-red-600" : "text-neutral-500"
      }`}
    >
      {sign}{delta.toLocaleString()}
    </span>
  )
}

function LedgerRow({ row }: { row: OrgLedgerRow }) {
  return (
    <div className="px-6 py-4 flex items-center gap-4">
      <LedgerIcon reason={row.reason} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-neutral-950 truncate">{row.movementLabel}</p>
        <p className="text-xs text-neutral-400 font-mono mt-0.5 truncate">
          {row.productName}
          {row.productSku ? ` · ${row.productSku}` : ""}
          {" · "}
          {row.branchName}
          {" · "}
          {formatDate(row.createdAt)}
        </p>
        {row.note && (
          <p className="text-xs text-neutral-500 mt-0.5 truncate">{row.note}</p>
        )}
      </div>
      <DeltaBadge delta={row.quantityDelta} />
    </div>
  )
}

export default async function OrgLedgerPage() {
  await requireOwner()

  const rows = await getOrgLedger(100)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Org Ledger</h1>
        <p className="text-sm text-neutral-500 mt-1">
          All stock movements across branches — most recent first
        </p>
      </div>

      {/* Feed */}
      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 px-8 py-12 text-center">
          <p className="text-sm text-neutral-500">No stock movements recorded yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-200/60 divide-y divide-neutral-100">
          {rows.map((row) => (
            <LedgerRow key={row.id} row={row} />
          ))}
        </div>
      )}

      {rows.length === 100 && (
        <p className="text-xs text-neutral-400 text-center pb-2">
          Showing most recent 100 movements. Enter a branch for full product-level history.
        </p>
      )}
    </div>
  )
}
