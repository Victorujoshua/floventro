import Link from "next/link"
import { Package, TrendingUp, ClipboardList, CreditCard, AlertCircle, Check } from "lucide-react"
import { requireOwner } from "@/lib/auth/guards"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getOrgOverview } from "@/lib/db/queries/org"
import { formatNaira } from "@/lib/format/money"
import { BranchStockChart } from "./branch-stock-chart"
import { BranchCards } from "./branch-cards"

export default async function OrgOverviewPage() {
  const scope = await requireOwner()

  const supabase = await createAppServerClient()
  const [orgResult, overview] = await Promise.all([
    supabase
      .from("organisations")
      .select("name")
      .eq("id", scope.organisationId)
      .maybeSingle(),
    getOrgOverview(),
  ])

  const orgName = orgResult.data?.name ?? "Organization"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">{orgName}</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Overview across {overview.branches.length} branch{overview.branches.length !== 1 ? "es" : ""}
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-tint-violet rounded-2xl border border-neutral-200/60 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Revenue (30d)</p>
            <TrendingUp className="h-4 w-4 text-violet-300" />
          </div>
          <p className="text-2xl font-semibold text-neutral-950 tabular-nums mt-3">
            <span className="font-inter">₦</span>{formatNaira(overview.revenueLast30dCents)}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            All time: <span className="font-inter">₦</span>{formatNaira(overview.revenueAllTimeCents)}
          </p>
        </div>

        <div className="bg-tint-violet rounded-2xl border border-neutral-200/60 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Total stock</p>
            <Package className="h-4 w-4 text-violet-300" />
          </div>
          <p className="text-2xl font-semibold text-neutral-950 tabular-nums mt-3">
            {overview.totalStockUnits.toLocaleString()}
          </p>
          <p className="text-xs text-neutral-500 mt-1 tabular-nums">
            {overview.poolStockUnits.toLocaleString()} in branches
            {overview.heldByStaffUnits > 0 && ` · ${overview.heldByStaffUnits.toLocaleString()} with staff`}
            {overview.inTransitUnits > 0 && ` · ${overview.inTransitUnits.toLocaleString()} in transit`}
          </p>
        </div>

        <div
          className={`${
            overview.pendingRequestCount === 0 ? "bg-tint-success" : "bg-tint-amber"
          } rounded-2xl border border-neutral-200/60 p-5`}
        >
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Pending requests</p>
            <ClipboardList className="h-4 w-4 text-neutral-300" />
          </div>
          {overview.pendingRequestCount === 0 ? (
            <>
              <p className="text-2xl font-semibold text-green-700 tabular-nums mt-3">0</p>
              <p className="text-xs text-green-700 mt-1">All reviewed</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-semibold text-amber-700 tabular-nums mt-3">
                {overview.pendingRequestCount}
              </p>
              <p className="text-xs text-neutral-500 mt-1">awaiting review</p>
            </>
          )}
        </div>

        <div
          className={`${
            overview.outstandingCents === 0 ? "bg-white" : "bg-tint-coral"
          } rounded-2xl border border-neutral-200/60 p-5`}
        >
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Outstanding payables</p>
            <CreditCard className="h-4 w-4 text-neutral-300" />
          </div>
          <p className="text-2xl font-semibold text-neutral-950 tabular-nums mt-3">
            <span className="font-inter">₦</span>{formatNaira(overview.outstandingCents)}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            {overview.outstandingCents === 0 ? "No open invoices" : "owed to vendors"}
          </p>
        </div>
      </div>

      {/* Stock-by-branch chart + needs attention */}
      <div className="grid md:grid-cols-3 gap-5">
        <div className="md:col-span-2 bg-tint-violet rounded-2xl border border-neutral-200/60 p-6">
          <h2 className="text-base font-semibold text-neutral-950 mb-1">Stock by branch</h2>
          <p className="text-xs text-neutral-500 mb-5">Units on hand per branch</p>
          <BranchStockChart branches={overview.branches} />
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200/60 p-6">
          <h2 className="text-base font-semibold text-neutral-950 mb-4">Needs attention</h2>
          <ul className="space-y-3">
            <li className="flex items-start gap-2.5">
              {overview.lowStockCount === 0 ? (
                <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-sm text-neutral-800">
                  {overview.lowStockCount === 0
                    ? "No products below reorder point"
                    : `${overview.lowStockCount} product${overview.lowStockCount !== 1 ? "s" : ""} at or below reorder point`}
                </p>
              </div>
            </li>

            <li className="flex items-start gap-2.5">
              {overview.pendingRequestCount === 0 ? (
                <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-sm text-neutral-800">
                  {overview.pendingRequestCount === 0
                    ? "No pending stock requests"
                    : `${overview.pendingRequestCount} stock request${overview.pendingRequestCount !== 1 ? "s" : ""} pending approval`}
                </p>
              </div>
            </li>

            <li className="flex items-start gap-2.5">
              {overview.outstandingCents === 0 ? (
                <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              )}
              <div>
                <p className="text-sm text-neutral-800">
                  {overview.outstandingCents === 0 ? (
                    "No outstanding vendor payables"
                  ) : (
                    <>
                      <span className="font-inter">₦</span>
                      {formatNaira(overview.outstandingCents)} outstanding to vendors
                    </>
                  )}
                </p>
              </div>
            </li>
          </ul>

          <div className="mt-6 pt-4 border-t border-neutral-100">
            <Link
              href="/org/ledger"
              className="text-xs text-violet-700 hover:underline"
            >
              View full org ledger →
            </Link>
          </div>
        </div>
      </div>

      {/* Branch cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-neutral-950">Branches</h2>
          <Link href="/admin/branches" className="text-xs text-violet-700 hover:underline">
            Manage →
          </Link>
        </div>
        <BranchCards branches={overview.branches} />
      </div>
    </div>
  )
}
