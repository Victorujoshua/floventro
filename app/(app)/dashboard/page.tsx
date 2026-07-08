import Link from "next/link"
import { Check } from "lucide-react"
import { requireScope } from "@/lib/auth/guards"
import {
  getStockSummary,
  getPayablesSummary,
  getRecentInvoices,
  getLowStockProducts,
} from "@/lib/db/queries/dashboard"
import { formatNaira } from "@/lib/format/money"

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    unpaid:  { label: "Unpaid",  className: "bg-amber-50 text-amber-700 border border-amber-200" },
    partial: { label: "Partial", className: "bg-amber-100 text-amber-800 border border-amber-300" },
    paid:    { label: "Paid",    className: "bg-green-50 text-green-700 border border-green-200" },
  }
  const entry = map[status] ?? map.unpaid
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${entry.className}`}>
      {entry.label}
    </span>
  )
}

function vendorName(vendors: unknown): string {
  if (!vendors) return "—"
  if (Array.isArray(vendors)) return (vendors[0] as { name?: string })?.name ?? "—"
  return (vendors as { name?: string }).name ?? "—"
}

export default async function DashboardPage() {
  const scope = await requireScope()
  const isInventoryUser = scope.role === "owner" || scope.role === "inventory"

  const [stock, payables, recentInvoices, lowStockProducts] = await Promise.all([
    getStockSummary(),
    isInventoryUser ? getPayablesSummary() : Promise.resolve(null),
    isInventoryUser ? getRecentInvoices(5) : Promise.resolve([]),
    isInventoryUser ? getLowStockProducts(5) : Promise.resolve([]),
  ])

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Dashboard</h1>
        <p className="text-sm text-neutral-500 mt-1">Welcome back</p>
      </div>

      {/* Metric cards */}
      <div className={`grid gap-4 mb-6 ${isInventoryUser ? "sm:grid-cols-3" : "max-w-xs"}`}>
        {/* Stock on hand */}
        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <p className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Stock on hand</p>
          <p className="text-3xl font-semibold text-neutral-950 tabular-nums">
            {stock.totalUnits.toLocaleString()}
          </p>
          <p className="text-sm text-neutral-500 mt-1">{stock.productsWithStock} products</p>
        </div>

        {/* Outstanding payables */}
        {isInventoryUser && payables && (
          <div className="bg-white rounded-lg border border-neutral-200 p-6">
            <p className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Outstanding payables</p>
            <p className="text-3xl font-semibold text-neutral-950 tabular-nums">
              <span className="font-inter">₦</span>{formatNaira(payables.outstandingCents)}
            </p>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <p className="text-sm text-neutral-500">
                {payables.unpaidCount} unpaid invoice{payables.unpaidCount !== 1 ? "s" : ""}
              </p>
              {payables.pastDueCount > 0 && (
                <span className="text-xs font-medium text-red-600">
                  {payables.pastDueCount} past due
                </span>
              )}
            </div>
          </div>
        )}

        {/* Low stock */}
        {isInventoryUser && (
          <div className="bg-white rounded-lg border border-neutral-200 p-6">
            <p className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Low stock</p>
            {stock.lowStockCount === 0 ? (
              <>
                <p className="text-3xl font-semibold text-green-600 tabular-nums">0</p>
                <p className="text-sm text-green-600 mt-1">All stocked</p>
              </>
            ) : (
              <>
                <p className="text-3xl font-semibold text-amber-600 tabular-nums">
                  {stock.lowStockCount}
                </p>
                <p className="text-sm text-neutral-500 mt-1">at or below reorder point</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Detail panels — owner / inventory only */}
      {isInventoryUser && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Recent invoices */}
          <div className="bg-white rounded-lg border border-neutral-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-neutral-950">Recent invoices</h2>
              <Link
                href="/inventory/invoices"
                className="text-xs text-violet-700 hover:underline"
              >
                View all →
              </Link>
            </div>
            {recentInvoices.length === 0 ? (
              <p className="text-sm text-neutral-500">No invoices yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {recentInvoices.map((inv) => (
                  <li key={inv.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-950 truncate">
                        {vendorName(inv.vendors)}
                      </p>
                      <p className="text-xs text-neutral-500 font-mono">
                        {inv.invoice_number ?? "—"} · {inv.invoice_date}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-mono tabular-nums text-neutral-700">
                        <span className="font-inter">₦</span>{formatNaira(inv.total_cents)}
                      </span>
                      <StatusBadge status={inv.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Low stock alerts */}
          <div className="bg-white rounded-lg border border-neutral-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-neutral-950">Low stock alerts</h2>
              <Link
                href="/inventory/products"
                className="text-xs text-violet-700 hover:underline"
              >
                View products →
              </Link>
            </div>
            {lowStockProducts.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Check className="h-4 w-4 text-green-500 shrink-0" />
                Nothing needs reordering
              </div>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {lowStockProducts.map((p) => (
                  <li key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-950 truncate">{p.name}</p>
                      <p className="text-xs text-neutral-500 font-mono">{p.sku ?? "—"}</p>
                    </div>
                    <span
                      className={`text-sm font-mono tabular-nums shrink-0 ${
                        p.quantity === 0 ? "text-red-600" : "text-amber-600"
                      }`}
                    >
                      {p.quantity} / {p.reorder_point}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
