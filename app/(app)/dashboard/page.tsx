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
  getPersonalHoldingSummary,
  getMyRecentSales,
  getMyPendingRequestCount,
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
  if (scope.role === "owner" && scope.branchId === null) {
    redirect("/org")
  }

  // Branch-level data is visible to roles that manage the branch.
  // sales / internal_use see only their own personal activity.
  const canSeeBranchData =
    scope.role === "owner" || scope.role === "admin" || scope.role === "inventory"

  const [
    stock,
    payables,
    recentInvoices,
    lowStockProducts,
    stockSeries,
    personalHolding,
    myRecentSales,
    myPendingCount,
  ] = await Promise.all([
    canSeeBranchData ? getStockSummary()        : Promise.resolve(null),
    canSeeBranchData ? getPayablesSummary()      : Promise.resolve(null),
    canSeeBranchData ? getRecentInvoices(5)      : Promise.resolve([]),
    canSeeBranchData ? getLowStockProducts(5)    : Promise.resolve([]),
    canSeeBranchData ? getStockReceivedSeries()  : Promise.resolve([]),
    canSeeBranchData ? Promise.resolve(null)     : getPersonalHoldingSummary(),
    canSeeBranchData ? Promise.resolve([])       : getMyRecentSales(5),
    canSeeBranchData ? Promise.resolve(0)        : getMyPendingRequestCount(),
  ])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Welcome back</h1>
        <p className="text-sm text-neutral-500 mt-1">
          {canSeeBranchData ? "Here’s your inventory at a glance" : "Here’s your activity at a glance"}
        </p>
      </div>

      {canSeeBranchData ? (
        <>
          {/* ── Branch-level metric cards ────────────────────────────────────── */}
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
                {stock!.totalUnits.toLocaleString()}
              </p>
              <p className="text-sm text-neutral-500 mt-1">{stock!.productsWithStock} products</p>
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
                stock!.lowStockCount === 0 ? "bg-tint-success" : "bg-tint-amber"
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
              {stock!.lowStockCount === 0 ? (
                <>
                  <p className="text-3xl font-semibold text-green-700 tabular-nums mt-3">0</p>
                  <p className="text-sm text-green-700 mt-1">All stocked</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-semibold text-amber-700 tabular-nums mt-3">
                    {stock!.lowStockCount}
                  </p>
                  <p className="text-sm text-neutral-500 mt-1">need reordering</p>
                </>
              )}
            </div>
          </div>

          {/* Stock received chart */}
          <div className="bg-tint-violet rounded-2xl border border-neutral-200/60 p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-semibold text-neutral-950">Stock received</h2>
                <p className="text-xs text-neutral-500 mt-0.5">Units received via vendor invoices — last 30 days</p>
              </div>
              <TrendingUp className="h-4 w-4 text-violet-400" />
            </div>
            <StockChart series={stockSeries as { date: string; units: number }[]} />
          </div>

          {/* Recent invoices + low-stock alerts */}
          <div className="grid md:grid-cols-2 gap-5">
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
        </>
      ) : (
        <>
          {/* ── Personal dashboard (sales / internal_use) ────────────────────── */}
          <div className="grid sm:grid-cols-2 gap-5 max-w-xl">
            {/* My holding */}
            <div className="bg-tint-violet rounded-2xl border border-neutral-200/60 p-6">
              <div className="flex items-start justify-between">
                <p className="text-xs uppercase tracking-wide text-neutral-500">My holding</p>
                <Link
                  href="/holding"
                  className="rounded-full bg-white/60 p-1.5 hover:bg-white transition-colors"
                >
                  <ArrowUpRight className="h-4 w-4 text-neutral-600" />
                </Link>
              </div>
              <p className="text-3xl font-semibold text-neutral-950 tabular-nums mt-3">
                {personalHolding?.totalUnits.toLocaleString() ?? 0}
              </p>
              <p className="text-sm text-neutral-500 mt-1">
                {personalHolding?.productCount ?? 0} product{(personalHolding?.productCount ?? 0) !== 1 ? "s" : ""}
              </p>
            </div>

            {/* Pending requests */}
            <div className={`${myPendingCount === 0 ? "bg-tint-success" : "bg-tint-amber"} rounded-2xl border border-neutral-200/60 p-6`}>
              <div className="flex items-start justify-between">
                <p className="text-xs uppercase tracking-wide text-neutral-500">Pending requests</p>
                <Link
                  href="/requests"
                  className="rounded-full bg-white/60 p-1.5 hover:bg-white transition-colors"
                >
                  <ArrowUpRight className="h-4 w-4 text-neutral-600" />
                </Link>
              </div>
              <p className={`text-3xl font-semibold tabular-nums mt-3 ${myPendingCount === 0 ? "text-green-700" : "text-amber-700"}`}>
                {myPendingCount}
              </p>
              <p className={`text-sm mt-1 ${myPendingCount === 0 ? "text-green-700" : "text-neutral-500"}`}>
                {myPendingCount === 0 ? "All clear" : "awaiting approval"}
              </p>
            </div>
          </div>

          {/* My recent sales */}
          <div className="bg-white rounded-2xl border border-neutral-200/60 p-6 max-w-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-neutral-950">My recent sales</h2>
              <Link href="/sales" className="text-xs text-violet-700 hover:underline">
                View all →
              </Link>
            </div>
            {myRecentSales.length === 0 ? (
              <p className="text-sm text-neutral-500">No sales recorded yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {myRecentSales.map((sale) => (
                  <li key={sale.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-950">
                        {sale.customer_name || "Walk-in"}
                      </p>
                      <p className="text-xs text-neutral-500 font-mono">{sale.sold_on}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-mono tabular-nums text-neutral-700">
                        <span className="font-inter">₦</span>{formatNaira(sale.total_cents)}
                      </span>
                      <StatusBadge status={sale.payment_status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
