import { TrendingUp, ShoppingCart, Percent, DollarSign } from "lucide-react"
import { requireOwner } from "@/lib/auth/guards"
import { getOrgSales } from "@/lib/db/queries/org"
import { formatNaira } from "@/lib/format/money"
import { BranchRevenueChart } from "./branch-revenue-chart"

function pct(value: number) {
  return `${value.toFixed(1)}%`
}

export default async function OrgSalesPage() {
  await requireOwner()

  const data = await getOrgSales()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Sales &amp; Revenue</h1>
        <p className="text-sm text-neutral-500 mt-1">Org-wide aggregates across all branches</p>
      </div>

      {/* Metric cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-tint-violet rounded-2xl border border-neutral-200/60 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Revenue (all time)</p>
            <ShoppingCart className="h-4 w-4 text-violet-300" />
          </div>
          <p className="text-2xl font-semibold text-neutral-950 tabular-nums mt-3">
            <span className="font-inter">₦</span>{formatNaira(data.revenueAllTimeCents)}
          </p>
          <p className="text-xs text-neutral-500 mt-1">all recorded sales</p>
        </div>

        <div className="bg-tint-violet rounded-2xl border border-neutral-200/60 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Revenue (30d)</p>
            <TrendingUp className="h-4 w-4 text-violet-300" />
          </div>
          <p className="text-2xl font-semibold text-neutral-950 tabular-nums mt-3">
            <span className="font-inter">₦</span>{formatNaira(data.revenueLast30dCents)}
          </p>
          <p className="text-xs text-neutral-500 mt-1">last 30 days</p>
        </div>

        <div className="bg-tint-success rounded-2xl border border-neutral-200/60 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Profit (30d)</p>
            <DollarSign className="h-4 w-4 text-green-400" />
          </div>
          <p className="text-2xl font-semibold text-neutral-950 tabular-nums mt-3">
            <span className="font-inter">₦</span>{formatNaira(data.profitLast30dCents)}
          </p>
          <p className="text-xs text-neutral-500 mt-1">revenue minus cost</p>
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200/60 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Avg margin (30d)</p>
            <Percent className="h-4 w-4 text-neutral-300" />
          </div>
          <p className="text-2xl font-semibold text-neutral-950 tabular-nums mt-3">
            {pct(data.avgMarginPct)}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            {data.revenueLast30dCents === 0 ? "no sales in period" : "gross margin"}
          </p>
        </div>
      </div>

      {/* Revenue / Profit chart by branch */}
      <div className="bg-white rounded-2xl border border-neutral-200/60 p-6">
        <h2 className="text-base font-semibold text-neutral-950 mb-1">
          Revenue &amp; profit by branch
        </h2>
        <p className="text-xs text-neutral-500 mb-5">Last 30 days · gross margin per branch</p>
        <BranchRevenueChart branches={data.branchRevenue} />
      </div>

      {/* Product performance + recent sales */}
      <div className="grid md:grid-cols-2 gap-5">
        {/* Product performance */}
        <div className="bg-white rounded-2xl border border-neutral-200/60 p-6">
          <h2 className="text-base font-semibold text-neutral-950 mb-4">Product performance</h2>
          {data.productPerformance.length === 0 ? (
            <p className="text-sm text-neutral-500">No sales recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100">
                    <th className="pb-2 text-left text-xs text-neutral-400 font-normal">Product</th>
                    <th className="pb-2 text-right text-xs text-neutral-400 font-normal">Qty</th>
                    <th className="pb-2 text-right text-xs text-neutral-400 font-normal">Revenue</th>
                    <th className="pb-2 text-right text-xs text-neutral-400 font-normal">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {data.productPerformance.map((p) => (
                    <tr key={p.productId}>
                      <td className="py-2.5 pr-3">
                        <p className="text-sm font-medium text-neutral-950 truncate max-w-[160px]">
                          {p.productName}
                        </p>
                        <p className="text-xs text-neutral-400 font-mono">{p.productSku}</p>
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-neutral-600 whitespace-nowrap">
                        {p.qtySold.toLocaleString()}
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-neutral-700 whitespace-nowrap">
                        <span className="font-inter">₦</span>
                        {formatNaira(p.revenueCents)}
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <span
                          className={
                            p.marginPct >= 20
                              ? "text-green-700"
                              : p.marginPct < 0
                              ? "text-red-600"
                              : "text-neutral-600"
                          }
                        >
                          {pct(p.marginPct)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent sales */}
        <div className="bg-white rounded-2xl border border-neutral-200/60 p-6">
          <h2 className="text-base font-semibold text-neutral-950 mb-4">Recent sales</h2>
          {data.recentSales.length === 0 ? (
            <p className="text-sm text-neutral-500">No sales recorded yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {data.recentSales.map((s) => (
                <li key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-950 truncate">
                      {s.customerName ?? "Walk-in"}
                    </p>
                    <p className="text-xs text-neutral-400 font-mono">
                      {s.branchName} · {s.soldOn}
                    </p>
                  </div>
                  <span className="text-sm font-mono tabular-nums text-neutral-700 shrink-0">
                    <span className="font-inter">₦</span>
                    {formatNaira(s.totalCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
