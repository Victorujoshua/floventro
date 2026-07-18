import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowUpRight, Check, TrendingUp } from "lucide-react"
import { requireScope } from "@/lib/auth/guards"
import {
  getStockSummary,
  getPayablesSummary,
  getRecentInvoices,
  getLowStockProducts,
  getStockReceivedSeries,
} from "@/lib/db/queries/dashboard"
import { formatNaira } from "@/lib/format/money"
import { StockChart } from "./stock-chart"

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    unpaid:  { label: "Unpaid",  className: "bg-neutral-100 text-neutral-600" },
    partial: { label: "Partial", className: "bg-tint-amber text-amber-700" },
    paid:    { label: "Paid",    className: "bg-tint-success text-green-700" },
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

  // Owner with no entered branch has no branch-level data to show — send to /org.
  // This is the anti-loop anchor: /org does NOT redirect owners back to /dashboard.
  if (scope.role === "owner" && scope.branchId === null) {
    redirect("/org")
  }

  const isInventoryUser = scope.role === "owner" || scope.role === "inventory"

  const [stock, payables, recentInvoices, lowStockProducts, stockSeries] = await Promise.all([
    getStockSummary(),
    isInventoryUser ? getPayablesSummary() : Promise.resolve(null),
    isInventoryUser ? getRecentInvoices(5) : Promise.resolve([]),
    isInventoryUser ? getLowStockProducts(5) : Promise.resolve([]),
    isInventoryUser ? getStockReceivedSeries() : Promise.resolve([]),
  ])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Welcome back</h1>
        <p className="text-sm text-neutral-500 mt-1">Here&apos;s your inventory at a glance</p>
      </div>

      {/* Metric cards */}
      {isInventoryUser ? (
        <div className="grid sm:grid-cols-3 gap-5">
          {/* Stock on hand */}
          <div className="bg-tint-violet rounded-2xl border border-neutral-200/60 p-6">
            <div className="flex items-start justify-between">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Stock on hand</p>
              <Link
                href="/inventory/products"
                className="rounded-full bg-white/60 p-1.5 hover:bg-white transition-colors"
              >
                <ArrowUpRight className="h-4 w-4 text-neutral-600" />
              </Link>
            </div>
            <p className="text-3xl font-semibold text-neutral-950 tabular-nums mt-3">
              {stock.totalUnits.toLocaleString()}
            </p>
            <p className="text-sm text-neutral-500 mt-1">{stock.productsWithStock} products</p>
          </div>

          {/* Outstanding payables */}
          {payables && (
            <div className="bg-tint-coral rounded-2xl border border-neutral-200/60 p-6">
              <div className="flex items-start justify-between">
                <p className="text-xs uppercase tracking-wide text-neutral-500">Outstanding payables</p>
                <Link
                  href="/inventory/invoices"
                  className="rounded-full bg-white/60 p-1.5 hover:bg-white transition-colors"
                >
                  <ArrowUpRight className="h-4 w-4 text-neutral-600" />
                </Link>
              </div>
              <p className="text-3xl font-semibold text-neutral-950 tabular-nums mt-3">
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
          <div
            className={`${
              stock.lowStockCount === 0 ? "bg-tint-success" : "bg-tint-amber"
            } rounded-2xl border border-neutral-200/60 p-6`}
          >
            <div className="flex items-start justify-between">
              <p className="text-xs uppercase tracking-wide text-neutral-500">Low stock</p>
              <Link
                href="/inventory/products"
                className="rounded-full bg-white/60 p-1.5 hover:bg-white transition-colors"
              >
                <ArrowUpRight className="h-4 w-4 text-neutral-600" />
              </Link>
            </div>
            {stock.lowStockCount === 0 ? (
              <>
                <p className="text-3xl font-semibold text-green-700 tabular-nums mt-3">0</p>
                <p className="text-sm text-green-700 mt-1">All stocked</p>
              </>
            ) : (
              <>
                <p className="text-3xl font-semibold text-amber-700 tabular-nums mt-3">
                  {stock.lowStockCount}
                </p>
                <p className="text-sm text-neutral-500 mt-1">need reordering</p>
              </>
            )}
          </div>
        </div>
      ) : (
        /* sales / internal_use: stock card only */
        <div className="max-w-xs">
          <div className="bg-tint-violet rounded-2xl border border-neutral-200/60 p-6">
            <p className="text-xs uppercase tracking-wide text-neutral-500 mb-3">Stock on hand</p>
            <p className="text-3xl font-semibold text-neutral-950 tabular-nums">
              {stock.totalUnits.toLocaleString()}
            </p>
            <p className="text-sm text-neutral-500 mt-1">{stock.productsWithStock} products</p>
          </div>
        </div>
      )}

      {/* Stock received chart */}
      {isInventoryUser && (
        <div className="bg-tint-violet rounded-2xl border border-neutral-200/60 p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-neutral-950">Stock received</h2>
              <p className="text-xs text-neutral-500 mt-0.5">Units received via vendor invoices — last 30 days</p>
            </div>
            <TrendingUp className="h-4 w-4 text-violet-400" />
          </div>
          <StockChart series={stockSeries} />
        </div>
      )}

      {/* Two-column panels */}
      {isInventoryUser && (
        <div className="grid md:grid-cols-2 gap-5">
          {/* Recent invoices */}
          <div className="bg-white rounded-2xl border border-neutral-200/60 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-neutral-950">Recent invoices</h2>
              <Link href="/inventory/invoices" className="text-xs text-violet-700 hover:underline">
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
          <div className="bg-white rounded-2xl border border-neutral-200/60 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-neutral-950">Low stock alerts</h2>
              <Link href="/inventory/products" className="text-xs text-violet-700 hover:underline">
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
