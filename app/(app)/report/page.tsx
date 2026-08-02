import { requireScope } from "@/lib/auth/guards"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getOrgOverview, getOrgSales, getOrgLedger, getBranchLedger } from "@/lib/db/queries/org"
import {
  getBranchFinancials,
  getStockSummary,
  getPayablesSummary,
  getStockReceivedSeries,
  getMySalesMetrics,
  getMyStockPerformance,
  getMyRecentSales,
  getMyPendingRequestCount,
  getLowStockProducts,
} from "@/lib/db/queries/dashboard"
import { getSales } from "@/lib/db/queries/sales"
import { getServiceRecords } from "@/lib/db/queries/services"
import { getInvoices } from "@/lib/db/queries/invoices"
import { getVendors } from "@/lib/db/queries/vendors"
import { getMyHoldings, getMyHoldingHistory, getBranchHoldings } from "@/lib/db/queries/holdings"
import { getTransfers } from "@/lib/db/queries/transfers"
import { getProducts } from "@/lib/db/queries/products"
import { ReportView } from "./report-view"
import type { ReportData, ReportInvoice, ReportVendor, ReportProduct, ReportLowStock } from "./report-view"

export default async function ReportPage() {
  const scope = await requireScope()
  const supabase = await createAppServerClient()

  const [{ data: authData }, orgRes, branchRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("organisations").select("name").eq("id", scope.organisationId).maybeSingle(),
    scope.branchId
      ? supabase.from("branches").select("name").eq("id", scope.branchId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const orgName = (orgRes.data as { name: string } | null)?.name ?? "Organisation"
  const branchName = (branchRes.data as { name: string } | null)?.name ?? null
  const userDisplayName =
    (authData?.user?.user_metadata?.full_name as string) ||
    authData?.user?.email ||
    "You"

  let data: ReportData

  if (scope.role === "owner" && !scope.branchId) {
    const [overview, sales, ledger] = await Promise.all([
      getOrgOverview(),
      getOrgSales(),
      getOrgLedger(30),
    ])
    data = { kind: "org", orgName, overview, sales, ledger }
  } else if (scope.role === "owner" || scope.role === "admin") {
    const branchId = scope.branchId!
    const [
      financials, stockSummary, payables, sales, allServiceRecords,
      invoicesRaw, vendorsRaw, holdings, transfers, lowStockRaw, branchLedger, receivedSeries,
    ] = await Promise.all([
      getBranchFinancials(),
      getStockSummary(),
      getPayablesSummary(),
      getSales(),
      getServiceRecords(),
      getInvoices(),
      getVendors(),
      getBranchHoldings(branchId),
      getTransfers(),
      getLowStockProducts(20),
      getBranchLedger(branchId, 30),
      getStockReceivedSeries(),
    ])
    data = {
      kind: "branch",
      orgName,
      branchName: branchName ?? "Branch",
      financials,
      stockSummary,
      payables,
      sales,
      serviceRecords: allServiceRecords,
      invoices: invoicesRaw as unknown as ReportInvoice[],
      vendors: vendorsRaw as unknown as ReportVendor[],
      holdings,
      transfers,
      lowStock: lowStockRaw as unknown as ReportLowStock[],
      branchLedger,
      receivedSeries,
    }
  } else if (scope.role === "inventory") {
    const branchId = scope.branchId!
    const [
      stockSummary, productsRaw, lowStockRaw, payables, invoicesRaw,
      vendorsRaw, holdings, transfers, branchLedger, receivedSeries,
    ] = await Promise.all([
      getStockSummary(),
      getProducts(),
      getLowStockProducts(20),
      getPayablesSummary(),
      getInvoices(),
      getVendors(),
      getBranchHoldings(branchId),
      getTransfers(),
      getBranchLedger(branchId, 30),
      getStockReceivedSeries(),
    ])
    data = {
      kind: "inventory",
      branchName: branchName ?? "Branch",
      stockSummary,
      products: productsRaw as unknown as ReportProduct[],
      lowStock: lowStockRaw as unknown as ReportLowStock[],
      payables,
      invoices: invoicesRaw as unknown as ReportInvoice[],
      vendors: vendorsRaw as unknown as ReportVendor[],
      holdings,
      transfers,
      branchLedger,
      receivedSeries,
    }
  } else if (scope.role === "sales") {
    const [metrics, stockPerf, recentSales, myHoldings, holdingHistory, pendingCount] =
      await Promise.all([
        getMySalesMetrics(),
        getMyStockPerformance(),
        getMyRecentSales(50),
        getMyHoldings(),
        getMyHoldingHistory(),
        getMyPendingRequestCount(),
      ])
    data = {
      kind: "sales",
      userName: userDisplayName,
      metrics,
      stockPerf,
      recentSales,
      holdings: myHoldings,
      holdingHistory,
      pendingCount,
    }
  } else {
    // internal_use
    const [myHoldings, holdingHistory, allServiceRecords, pendingCount] = await Promise.all([
      getMyHoldings(),
      getMyHoldingHistory(),
      getServiceRecords(),
      getMyPendingRequestCount(),
    ])
    // Filter service records to this user's own performed services
    const myServiceRecords = allServiceRecords.filter(
      (r) => r.performedByUserId === scope.userId,
    )
    data = {
      kind: "internal_use",
      userName: userDisplayName,
      holdings: myHoldings,
      holdingHistory,
      myServiceRecords,
      pendingCount,
    }
  }

  return <ReportView data={data} />
}
