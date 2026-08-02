"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Download } from "lucide-react"
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer,
} from "recharts"
import { cn } from "@/lib/utils"
import type { OrgOverview, OrgSalesData, OrgLedgerRow } from "@/lib/db/queries/org"
import type { BranchFinancials, MySalesMetrics, MyStockPerformanceRow } from "@/lib/db/queries/dashboard"
import type { SaleRow } from "@/lib/db/queries/sales"
import type { ServiceRecordRow } from "@/lib/db/queries/services"
import type { MyHolding, ProductHoldingHistory, HolderGroup } from "@/lib/db/queries/holdings"
import type { Transfer } from "@/lib/db/queries/transfers"

// ── Types for queries without exported return types ───────────────────────────

export type ReportInvoice = {
  id: string
  invoice_number: string | null
  invoice_date: string
  due_date: string | null
  total_cents: number
  amount_paid_cents: number
  status: string
  vendors: { name: string } | { name: string }[] | null
}

export type ReportVendor = {
  id: string
  name: string
  outstanding_cents: number
}

export type ReportProduct = {
  id: string
  sku: string
  name: string
  reorder_point: number
  stock: number
}

export type ReportLowStock = {
  id: string
  sku: string
  name: string
  reorder_point: number
  quantity: number
}

type StockSummary = { totalUnits: number; productsWithStock: number; lowStockCount: number }
type PayablesSummary = { outstandingCents: number; unpaidCount: number; pastDueCount: number }
type ReportSale = { id: string; sold_on: string; customer_name: string | null; total_cents: number; payment_status: string }

// ── Discriminated union ───────────────────────────────────────────────────────

export type ReportData =
  | {
      kind: "org"
      orgName: string
      overview: OrgOverview
      sales: OrgSalesData
      ledger: OrgLedgerRow[]
    }
  | {
      kind: "branch"
      orgName: string
      branchName: string
      financials: BranchFinancials
      stockSummary: StockSummary
      payables: PayablesSummary
      sales: SaleRow[]
      serviceRecords: ServiceRecordRow[]
      invoices: ReportInvoice[]
      vendors: ReportVendor[]
      holdings: HolderGroup[]
      transfers: Transfer[]
      lowStock: ReportLowStock[]
      branchLedger: OrgLedgerRow[]
      receivedSeries: { date: string; units: number }[]
    }
  | {
      kind: "inventory"
      branchName: string
      stockSummary: StockSummary
      products: ReportProduct[]
      lowStock: ReportLowStock[]
      payables: PayablesSummary
      invoices: ReportInvoice[]
      vendors: ReportVendor[]
      holdings: HolderGroup[]
      transfers: Transfer[]
      branchLedger: OrgLedgerRow[]
      receivedSeries: { date: string; units: number }[]
    }
  | {
      kind: "sales"
      userName: string
      metrics: MySalesMetrics
      stockPerf: MyStockPerformanceRow[]
      recentSales: ReportSale[]
      holdings: MyHolding[]
      holdingHistory: ProductHoldingHistory[]
      pendingCount: number
    }
  | {
      kind: "internal_use"
      userName: string
      holdings: MyHolding[]
      holdingHistory: ProductHoldingHistory[]
      myServiceRecords: ServiceRecordRow[]
      pendingCount: number
    }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(cents: number) {
  return "₦" + (cents / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function resolveVendorName(v: ReportInvoice["vendors"]) {
  if (!v) return "—"
  if (Array.isArray(v)) return v[0]?.name ?? "—"
  return v.name
}

// ── Primitives ────────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  delay = 0,
  muted = false,
}: {
  label: string
  value: string
  sub?: string
  delay?: number
  muted?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.23, 1, 0.32, 1] }}
      className="rounded-2xl border border-neutral-200/60 bg-white p-5"
    >
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-400">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", muted ? "text-neutral-400" : "text-neutral-950")}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>}
    </motion.div>
  )
}

function ChartCard({
  title,
  delay,
  children,
}: {
  title: string
  delay?: number
  children: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: delay ?? 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="rounded-2xl border border-neutral-200/60 bg-white p-5"
    >
      <p className="mb-4 text-sm font-medium text-neutral-500">{title}</p>
      {children}
    </motion.div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-neutral-400">{children}</h2>
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200/60 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={cn("border-b border-neutral-100 bg-neutral-50 px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-neutral-500", right ? "text-right" : "text-left")}>
      {children}
    </th>
  )
}

function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td className={cn("px-5 py-3 text-neutral-700", right ? "text-right" : "text-left", mono ? "font-mono tabular-nums" : "")}>
      {children}
    </td>
  )
}

function EmptyRow({ cols, msg = "No data" }: { cols: number; msg?: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-5 py-8 text-center text-sm text-neutral-400">{msg}</td>
    </tr>
  )
}

// ── Period toggle ─────────────────────────────────────────────────────────────

function PeriodToggle({
  period,
  onChange,
}: {
  period: "30d" | "all_time"
  onChange: (p: "30d" | "all_time") => void
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-neutral-200 p-0.5">
      {(["30d", "all_time"] as const).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-colors",
            period === p ? "bg-neutral-950 text-white" : "text-neutral-500 hover:text-neutral-700",
          )}
        >
          {p === "30d" ? "30 days" : "All time"}
        </button>
      ))}
    </div>
  )
}

// ── XLS export ────────────────────────────────────────────────────────────────

async function exportXLS(data: ReportData) {
  const XLSX = await import("xlsx")
  const wb = XLSX.utils.book_new()
  const today = new Date().toISOString().split("T")[0]

  function add(name: string, rows: Record<string, string | number | null | undefined>[]) {
    if (rows.length === 0) return
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name)
  }
  function addAoa(name: string, rows: (string | number | null | undefined)[][]) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows as unknown[][]), name)
  }
  const n = (cents: number) => +(cents / 100).toFixed(2)
  const nn = (cents: number | null) => (cents !== null ? +(cents / 100).toFixed(2) : "")

  if (data.kind === "org") {
    addAoa("Summary", [
      ["Metric", "Value"],
      ["Revenue 30d (₦)", n(data.overview.revenueLast30dCents)],
      ["Revenue all-time (₦)", n(data.overview.revenueAllTimeCents)],
      ["Gross Profit 30d (₦)", nn(data.overview.profitLast30dCents)],
      ["Margin % (30d)", data.overview.avgMarginPct ?? ""],
      ["Total Stock Units", data.overview.totalStockUnits],
      ["Outstanding Payables (₦)", n(data.overview.outstandingCents)],
      ["Pending Requests", data.overview.pendingRequestCount],
      ["Low Stock Products", data.overview.lowStockCount],
    ])
    add("Per-branch", data.overview.branches.map((b) => ({
      Branch: b.name,
      "Revenue 30d (₦)": n(b.revenueLast30dCents),
      "Stock Units": b.stockUnits,
    })))
    add("Top products", data.sales.productPerformance.map((p) => ({
      SKU: p.productSku,
      Product: p.productName,
      "Qty Sold": p.qtySold,
      "Revenue (₦)": n(p.revenueCents),
      "Cost (₦)": nn(p.costCents),
      "Margin %": p.marginPct ?? "",
    })))
    add("Recent activity", data.ledger.map((r) => ({
      Date: r.createdAt.split("T")[0],
      Branch: r.branchName,
      SKU: r.productSku,
      Product: r.productName,
      Movement: r.movementLabel,
      "Δ Units": r.quantityDelta,
    })))
  } else if (data.kind === "branch") {
    addAoa("Summary", [
      ["Metric", "Value"],
      ["Branch", data.branchName],
      ["Organisation", data.orgName],
      ["Revenue 30d (₦)", n(data.financials.revenueLast30dCents)],
      ["Gross Profit 30d (₦)", nn(data.financials.profitLast30dCents)],
      ["Margin %", data.financials.avgMarginPct ?? ""],
      ["Total Stock Units", data.stockSummary.totalUnits],
      ["Products with Stock", data.stockSummary.productsWithStock],
      ["Low Stock Products", data.stockSummary.lowStockCount],
      ["Outstanding Payables (₦)", n(data.payables.outstandingCents)],
      ["Unpaid Invoices", data.payables.unpaidCount],
      ["Past-due Invoices", data.payables.pastDueCount],
    ])
    add("Sales", data.sales.map((s) => ({
      Date: s.soldOn,
      Seller: s.sellerLabel,
      Customer: s.customerName ?? "",
      "Total (₦)": n(s.totalCents),
      "Amount Paid (₦)": n(s.amountPaidCents),
      "Payment Method": s.paymentMethod ?? "",
      Status: s.paymentStatus,
    })))
    add("Services", data.serviceRecords.map((r) => ({
      Date: r.performedOn,
      Service: r.serviceTypeName,
      "Performed By": r.performedByLabel,
      Customer: r.customerName ?? "",
      "Fee (₦)": nn(r.serviceFeeCents),
      "Products Used": r.consumptionCount,
    })))
    add("Received (30d)", data.receivedSeries.map((d) => ({
      Date: d.date,
      "Units Received": d.units,
    })))
    add("Low stock", data.lowStock.map((p) => ({
      SKU: p.sku,
      Product: p.name,
      "In Stock": p.quantity,
      "Reorder At": p.reorder_point,
    })))
    add("Invoices", data.invoices.map((inv) => ({
      "Invoice #": inv.invoice_number ?? "",
      Date: inv.invoice_date,
      "Due Date": inv.due_date ?? "",
      Vendor: resolveVendorName(inv.vendors),
      "Total (₦)": n(inv.total_cents),
      "Paid (₦)": n(inv.amount_paid_cents),
      Status: inv.status,
    })))
    add("Vendors", data.vendors.map((v) => ({
      Vendor: v.name,
      "Outstanding (₦)": n(v.outstanding_cents),
    })))
    add("Holdings", data.holdings.flatMap((g) =>
      g.items.map((item) => ({
        Holder: g.holderName || g.holderEmail,
        SKU: item.productSku,
        Product: item.productName,
        Qty: item.quantity,
      })),
    ))
    add("Transfers", data.transfers.map((t) => ({
      Date: t.initiatedAt.split("T")[0],
      From: t.sourceBranchName,
      To: t.destBranchName,
      Status: t.status,
      "Initiated By": t.initiatedByLabel,
    })))
    add("Recent movements", data.branchLedger.map((r) => ({
      Date: r.createdAt.split("T")[0],
      SKU: r.productSku,
      Product: r.productName,
      Movement: r.movementLabel,
      "Δ Units": r.quantityDelta,
    })))
  } else if (data.kind === "inventory") {
    addAoa("Stock summary", [
      ["Metric", "Value"],
      ["Branch", data.branchName],
      ["Total Stock Units", data.stockSummary.totalUnits],
      ["Products with Stock", data.stockSummary.productsWithStock],
      ["Low Stock Products", data.stockSummary.lowStockCount],
      ["Outstanding Payables (₦)", n(data.payables.outstandingCents)],
      ["Past-due Invoices", data.payables.pastDueCount],
      ["Units Received 30d", data.receivedSeries.reduce((s, d) => s + d.units, 0)],
    ])
    add("Products", data.products.map((p) => ({
      SKU: p.sku,
      Product: p.name,
      "In Stock": p.stock,
      "Reorder At": p.reorder_point > 0 ? p.reorder_point : "",
    })))
    add("Low stock", data.lowStock.map((p) => ({
      SKU: p.sku,
      Product: p.name,
      "In Stock": p.quantity,
      "Reorder At": p.reorder_point,
    })))
    add("Received (30d)", data.receivedSeries.map((d) => ({
      Date: d.date,
      "Units Received": d.units,
    })))
    add("Invoices", data.invoices.map((inv) => ({
      "Invoice #": inv.invoice_number ?? "",
      Date: inv.invoice_date,
      "Due Date": inv.due_date ?? "",
      Vendor: resolveVendorName(inv.vendors),
      "Total (₦)": n(inv.total_cents),
      "Paid (₦)": n(inv.amount_paid_cents),
      Status: inv.status,
    })))
    add("Vendors", data.vendors.map((v) => ({
      Vendor: v.name,
      "Outstanding (₦)": n(v.outstanding_cents),
    })))
    add("Holdings", data.holdings.flatMap((g) =>
      g.items.map((item) => ({
        Holder: g.holderName || g.holderEmail,
        SKU: item.productSku,
        Product: item.productName,
        Qty: item.quantity,
      })),
    ))
    add("Transfers", data.transfers.map((t) => ({
      Date: t.initiatedAt.split("T")[0],
      From: t.sourceBranchName,
      To: t.destBranchName,
      Status: t.status,
      "Initiated By": t.initiatedByLabel,
    })))
    add("Branch ledger", data.branchLedger.map((r) => ({
      Date: r.createdAt.split("T")[0],
      SKU: r.productSku,
      Product: r.productName,
      Movement: r.movementLabel,
      "Δ Units": r.quantityDelta,
    })))
  } else if (data.kind === "sales") {
    addAoa("My summary", [
      ["Metric", "Value"],
      ["Name", data.userName],
      ["Revenue 30d (₦)", n(data.metrics.revenueLast30dCents)],
      ["Gross Profit 30d (₦)", nn(data.metrics.profitLast30dCents)],
      ["Margin %", data.metrics.marginPct ?? ""],
      ["Units in Hand", data.holdings.reduce((s, h) => s + h.quantity, 0)],
      ["Pending Requests", data.pendingCount],
    ])
    add("Stock performance", data.stockPerf.map((p) => ({
      SKU: p.sku,
      Product: p.name,
      "In Hand": p.inHand,
      "Sold 30d": p.sold30d,
      "Sell-through %": p.sellThrough,
    })))
    add("My sales", data.recentSales.map((s) => ({
      Date: s.sold_on,
      Customer: s.customer_name ?? "",
      "Total (₦)": n(s.total_cents),
      Status: s.payment_status,
    })))
    add("My holdings", data.holdings.map((h) => ({
      SKU: h.productSku,
      Product: h.productName,
      Branch: h.branchName,
      Qty: h.quantity,
    })))
    add("Holding movements", data.holdingHistory.flatMap((p) =>
      p.movements.map((m) => ({
        Date: m.createdAt.split("T")[0],
        Product: p.productName,
        SKU: p.productSku,
        Movement: m.movementLabel,
        "Δ Qty": m.quantityDelta,
        "Balance Before": m.balanceBefore,
        "Balance After": m.balanceAfter,
      })),
    ))
  } else if (data.kind === "internal_use") {
    add("My holdings", data.holdings.map((h) => ({
      SKU: h.productSku,
      Product: h.productName,
      Branch: h.branchName,
      Qty: h.quantity,
    })))
    add("Holding movements", data.holdingHistory.flatMap((p) =>
      p.movements.map((m) => ({
        Date: m.createdAt.split("T")[0],
        Product: p.productName,
        SKU: p.productSku,
        Movement: m.movementLabel,
        "Δ Qty": m.quantityDelta,
        "Balance Before": m.balanceBefore,
        "Balance After": m.balanceAfter,
      })),
    ))
    add("My services", data.myServiceRecords.map((r) => ({
      Date: r.performedOn,
      Service: r.serviceTypeName,
      Customer: r.customerName ?? "",
      "Fee (₦)": nn(r.serviceFeeCents),
      "Products Used": r.consumptionCount,
    })))
  }

  XLSX.writeFile(wb, `floventro-report-${data.kind}-${today}.xlsx`)
}

function DownloadButton({ data }: { data: ReportData }) {
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    setBusy(true)
    try {
      await exportXLS(data)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-md border border-neutral-200 px-4 h-9 text-sm font-medium text-neutral-600 hover:bg-neutral-50 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Download className="h-4 w-4" />
      {busy ? "Building…" : "Download XLS"}
    </button>
  )
}

// ── ORG report ────────────────────────────────────────────────────────────────

function OrgReport({ data, period }: { data: Extract<ReportData, { kind: "org" }>; period: "30d" | "all_time" }) {
  const { overview, sales } = data

  const revenue = period === "30d" ? overview.revenueLast30dCents : overview.revenueAllTimeCents
  const profit = period === "30d" ? overview.profitLast30dCents : null // all-time profit not computed
  const margin = period === "30d" ? overview.avgMarginPct : null

  const branchRevData = sales.branchRevenue
    .filter((b) => b.revenueCents > 0)
    .map((b) => ({
      name: b.branchName.length > 20 ? b.branchName.slice(0, 18) + "…" : b.branchName,
      revenue: +(b.revenueCents / 100).toFixed(2),
    }))
  const topProductsData = sales.productPerformance
    .slice(0, 8)
    .map((p) => ({
      name: p.productName.length > 22 ? p.productName.slice(0, 20) + "…" : p.productName,
      revenue: +(p.revenueCents / 100).toFixed(2),
    }))
    .reverse()

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Revenue" value={fmtMoney(revenue)} sub={period === "30d" ? "Last 30 days" : "All time"} delay={0.05} />
        <MetricCard
          label="Gross Profit"
          value={profit !== null ? fmtMoney(profit) : "—"}
          sub={profit === null ? "Cost data incomplete" : "Last 30 days"}
          delay={0.1}
          muted={profit === null}
        />
        <MetricCard
          label="Margin"
          value={margin !== null ? `${margin}%` : "—"}
          delay={0.15}
          muted={margin === null}
        />
        <MetricCard label="Total Stock" value={overview.totalStockUnits.toLocaleString()} sub="Units across org" delay={0.2} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <MetricCard label="Outstanding Payables" value={fmtMoney(overview.outstandingCents)} delay={0.25} />
        <MetricCard label="Pending Requests" value={overview.pendingRequestCount.toString()} delay={0.3} />
        <MetricCard label="Low Stock Products" value={overview.lowStockCount.toString()} delay={0.35} />
      </div>

      {(branchRevData.length > 0 || topProductsData.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {branchRevData.length > 0 && (
            <ChartCard title="Revenue by branch (30d)" delay={0.4}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={branchRevData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: unknown) => Number(v) >= 1000 ? `₦${(Number(v) / 1000).toFixed(0)}k` : `₦${Number(v).toFixed(0)}`} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v: unknown) => `₦${Number(v).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`} />
                  <Bar dataKey="revenue" fill="#6d28d9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {topProductsData.length > 0 && (
            <ChartCard title="Top products by revenue" delay={0.45}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart layout="vertical" data={topProductsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} tickFormatter={(v: unknown) => Number(v) >= 1000 ? `₦${(Number(v) / 1000).toFixed(0)}k` : `₦${Number(v).toFixed(0)}`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} width={120} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v: unknown) => `₦${Number(v).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`} />
                  <Bar dataKey="revenue" fill="#7c3aed" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      <SectionTitle>Branch Performance</SectionTitle>
      <TableWrap>
        <thead>
          <tr>
            <Th>Branch</Th>
            <Th right>Revenue 30d</Th>
            <Th right>Stock Units</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {overview.branches.length === 0 ? (
            <EmptyRow cols={3} />
          ) : (
            overview.branches.map((b) => (
              <tr key={b.id} className="hover:bg-neutral-50/60">
                <Td>{b.name}</Td>
                <Td right mono>{fmtMoney(b.revenueLast30dCents)}</Td>
                <Td right mono>{b.stockUnits.toLocaleString()}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>

      <SectionTitle>Top Products</SectionTitle>
      <TableWrap>
        <thead>
          <tr>
            <Th>SKU</Th>
            <Th>Product</Th>
            <Th right>Qty Sold</Th>
            <Th right>Revenue</Th>
            <Th right>Margin</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {sales.productPerformance.length === 0 ? (
            <EmptyRow cols={5} />
          ) : (
            sales.productPerformance.map((p) => (
              <tr key={p.productId} className="hover:bg-neutral-50/60">
                <Td mono>{p.productSku}</Td>
                <Td>{p.productName}</Td>
                <Td right mono>{p.qtySold.toLocaleString()}</Td>
                <Td right mono>{fmtMoney(p.revenueCents)}</Td>
                <Td right mono>{p.marginPct !== null ? `${p.marginPct}%` : "—"}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>

      <SectionTitle>Recent Stock Movements</SectionTitle>
      <LedgerTable rows={data.ledger} showBranch />
    </>
  )
}

// ── BRANCH report ─────────────────────────────────────────────────────────────

function BranchReport({ data }: { data: Extract<ReportData, { kind: "branch" }> }) {
  const { financials, stockSummary, payables } = data

  const salesByDate = new Map<string, number>()
  for (const s of data.sales) {
    const d = s.soldOn.slice(0, 10)
    salesByDate.set(d, (salesByDate.get(d) ?? 0) + s.totalCents / 100)
  }
  const salesTrend = [...salesByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, total]) => ({ date: date.slice(5), total: +total.toFixed(2) }))
  const receivedData = data.receivedSeries.map((d) => ({ date: d.date.slice(5), units: d.units }))

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Revenue" value={fmtMoney(financials.revenueLast30dCents)} sub="Last 30 days" delay={0.05} />
        <MetricCard
          label="Gross Profit"
          value={financials.profitLast30dCents !== null ? fmtMoney(financials.profitLast30dCents) : "—"}
          sub={financials.profitLast30dCents === null ? "Cost data incomplete" : "Last 30 days"}
          delay={0.1}
          muted={financials.profitLast30dCents === null}
        />
        <MetricCard
          label="Margin"
          value={financials.avgMarginPct !== null ? `${financials.avgMarginPct}%` : "—"}
          delay={0.15}
          muted={financials.avgMarginPct === null}
        />
        <MetricCard label="Stock Units" value={stockSummary.totalUnits.toLocaleString()} sub={`${stockSummary.productsWithStock} products`} delay={0.2} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <MetricCard label="Outstanding Payables" value={fmtMoney(payables.outstandingCents)} sub={`${payables.unpaidCount} unpaid invoices`} delay={0.25} />
        <MetricCard label="Past-due Invoices" value={payables.pastDueCount.toString()} delay={0.3} />
        <MetricCard label="Low Stock Products" value={stockSummary.lowStockCount.toString()} delay={0.35} />
      </div>

      {(salesTrend.length > 0 || receivedData.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {salesTrend.length > 0 && (
            <ChartCard title="Sales trend" delay={0.4}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={salesTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: unknown) => Number(v) >= 1000 ? `₦${(Number(v) / 1000).toFixed(0)}k` : `₦${Number(v).toFixed(0)}`} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v: unknown) => `₦${Number(v).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`} />
                  <Bar dataKey="total" fill="#6d28d9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {receivedData.length > 0 && (
            <ChartCard title="Stock received (30d)" delay={0.45}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={receivedData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={35} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v: unknown) => `${Number(v)} units`} />
                  <Line type="monotone" dataKey="units" stroke="#7c3aed" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      <SectionTitle>Recent Sales</SectionTitle>
      <TableWrap>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Seller</Th>
            <Th>Customer</Th>
            <Th right>Total</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {data.sales.length === 0 ? (
            <EmptyRow cols={5} />
          ) : (
            data.sales.slice(0, 50).map((s) => (
              <tr key={s.id} className="hover:bg-neutral-50/60">
                <Td>{fmtDate(s.soldOn)}</Td>
                <Td>{s.sellerLabel}</Td>
                <Td>{s.customerName ?? "—"}</Td>
                <Td right mono>{fmtMoney(s.totalCents)}</Td>
                <Td>{s.paymentStatus}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>

      {data.serviceRecords.length > 0 && (
        <>
          <SectionTitle>Services Performed</SectionTitle>
          <TableWrap>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Service</Th>
                <Th>Performed By</Th>
                <Th>Customer</Th>
                <Th right>Fee</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.serviceRecords.slice(0, 50).map((r) => (
                <tr key={r.id} className="hover:bg-neutral-50/60">
                  <Td>{fmtDate(r.performedOn)}</Td>
                  <Td>{r.serviceTypeName}</Td>
                  <Td>{r.performedByLabel}</Td>
                  <Td>{r.customerName ?? "—"}</Td>
                  <Td right mono>{r.serviceFeeCents !== null ? fmtMoney(r.serviceFeeCents) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}

      {data.lowStock.length > 0 && (
        <>
          <SectionTitle>Low Stock Alerts</SectionTitle>
          <LowStockTable rows={data.lowStock} />
        </>
      )}

      <SectionTitle>Vendor Payables</SectionTitle>
      <VendorTable vendors={data.vendors} />

      {data.holdings.length > 0 && (
        <>
          <SectionTitle>Staff Holdings</SectionTitle>
          <HoldingsTable groups={data.holdings} />
        </>
      )}

      {data.transfers.length > 0 && (
        <>
          <SectionTitle>Transfers</SectionTitle>
          <TransfersTable transfers={data.transfers} />
        </>
      )}

      <SectionTitle>Recent Stock Movements</SectionTitle>
      <LedgerTable rows={data.branchLedger} />
    </>
  )
}

// ── INVENTORY report ──────────────────────────────────────────────────────────

function InventoryReport({ data }: { data: Extract<ReportData, { kind: "inventory" }> }) {
  const { stockSummary, payables, receivedSeries } = data
  const receivedTotal = receivedSeries.reduce((s, d) => s + d.units, 0)

  const receivedChartData = receivedSeries.map((d) => ({ date: d.date.slice(5), units: d.units }))
  const topByStock = [...data.products]
    .filter((p) => p.stock > 0)
    .sort((a, b) => b.stock - a.stock)
    .slice(0, 10)
    .map((p) => ({
      name: p.name.length > 22 ? p.name.slice(0, 20) + "…" : p.name,
      stock: p.stock,
    }))
    .reverse()

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Total Stock Units" value={stockSummary.totalUnits.toLocaleString()} sub={`${stockSummary.productsWithStock} products with stock`} delay={0.05} />
        <MetricCard label="Low Stock Products" value={stockSummary.lowStockCount.toString()} delay={0.1} />
        <MetricCard label="Outstanding Payables" value={fmtMoney(payables.outstandingCents)} sub={`${payables.pastDueCount} past-due`} delay={0.15} />
        <MetricCard label="Received (30d)" value={receivedTotal.toLocaleString()} sub="Units received from vendors" delay={0.2} />
      </div>

      {(receivedChartData.length > 0 || topByStock.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {receivedChartData.length > 0 && (
            <ChartCard title="Stock received (30d)" delay={0.25}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={receivedChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={35} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v: unknown) => `${Number(v)} units`} />
                  <Line type="monotone" dataKey="units" stroke="#7c3aed" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {topByStock.length > 0 && (
            <ChartCard title="Top products by stock" delay={0.3}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart layout="vertical" data={topByStock}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#374151" }} axisLine={false} tickLine={false} width={120} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v: unknown) => `${Number(v)} units`} />
                  <Bar dataKey="stock" fill="#7c3aed" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      {data.lowStock.length > 0 && (
        <>
          <SectionTitle>Low Stock Alerts</SectionTitle>
          <LowStockTable rows={data.lowStock} />
        </>
      )}

      <SectionTitle>All Products</SectionTitle>
      <TableWrap>
        <thead>
          <tr>
            <Th>SKU</Th>
            <Th>Product</Th>
            <Th right>In Stock</Th>
            <Th right>Reorder At</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {data.products.length === 0 ? (
            <EmptyRow cols={4} />
          ) : (
            data.products.map((p) => (
              <tr key={p.id} className={cn("hover:bg-neutral-50/60", p.stock <= p.reorder_point && p.reorder_point > 0 ? "bg-amber-50/40" : "")}>
                <Td mono>{p.sku}</Td>
                <Td>{p.name}</Td>
                <Td right mono>{p.stock.toLocaleString()}</Td>
                <Td right mono>{p.reorder_point > 0 ? p.reorder_point.toLocaleString() : "—"}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>

      <SectionTitle>Vendor Payables</SectionTitle>
      <VendorTable vendors={data.vendors} />

      {data.holdings.length > 0 && (
        <>
          <SectionTitle>Staff Holdings</SectionTitle>
          <HoldingsTable groups={data.holdings} />
        </>
      )}

      {data.transfers.length > 0 && (
        <>
          <SectionTitle>Transfers</SectionTitle>
          <TransfersTable transfers={data.transfers} />
        </>
      )}

      <SectionTitle>Recent Stock Movements</SectionTitle>
      <LedgerTable rows={data.branchLedger} />
    </>
  )
}

// ── SALES personal report ─────────────────────────────────────────────────────

function SalesReport({ data }: { data: Extract<ReportData, { kind: "sales" }> }) {
  const { metrics } = data
  const totalHeld = data.holdings.reduce((s, h) => s + h.quantity, 0)

  const perfChartData = data.stockPerf
    .filter((p) => p.inHand > 0 || p.sold30d > 0)
    .slice(0, 10)
    .map((p) => ({
      name: p.name.length > 18 ? p.name.slice(0, 16) + "…" : p.name,
      inHand: p.inHand,
      sold30d: p.sold30d,
    }))

  const salesByDate = new Map<string, number>()
  for (const s of data.recentSales) {
    const d = s.sold_on.slice(0, 10)
    salesByDate.set(d, (salesByDate.get(d) ?? 0) + s.total_cents / 100)
  }
  const salesTrend = [...salesByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date: date.slice(5), total: +total.toFixed(2) }))

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Revenue" value={fmtMoney(metrics.revenueLast30dCents)} sub="Last 30 days" delay={0.05} />
        <MetricCard
          label="Gross Profit"
          value={metrics.profitLast30dCents !== null ? fmtMoney(metrics.profitLast30dCents) : "—"}
          sub={metrics.profitLast30dCents === null ? "Cost data incomplete" : "Last 30 days"}
          delay={0.1}
          muted={metrics.profitLast30dCents === null}
        />
        <MetricCard
          label="Margin"
          value={metrics.marginPct !== null ? `${metrics.marginPct}%` : "—"}
          delay={0.15}
          muted={metrics.marginPct === null}
        />
        <MetricCard label="Units in Hand" value={totalHeld.toLocaleString()} sub={`${data.holdings.length} product${data.holdings.length !== 1 ? "s" : ""}`} delay={0.2} />
      </div>
      {data.pendingCount > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-4">
          <MetricCard label="Pending Requests" value={data.pendingCount.toString()} delay={0.25} />
        </div>
      )}

      {(perfChartData.length > 0 || salesTrend.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {perfChartData.length > 0 && (
            <ChartCard title="Product performance (30d)" delay={0.3}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={perfChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={45} />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} />
                  <Bar dataKey="inHand" name="In hand" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="sold30d" name="Sold 30d" fill="#6d28d9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {salesTrend.length > 0 && (
            <ChartCard title="My sales over time" delay={0.35}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={salesTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v: unknown) => Number(v) >= 1000 ? `₦${(Number(v) / 1000).toFixed(0)}k` : `₦${Number(v).toFixed(0)}`} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v: unknown) => `₦${Number(v).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`} />
                  <Bar dataKey="total" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      <SectionTitle>Product Performance</SectionTitle>
      <TableWrap>
        <thead>
          <tr>
            <Th>SKU</Th>
            <Th>Product</Th>
            <Th right>In Hand</Th>
            <Th right>Sold (30d)</Th>
            <Th right>Sell-through</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {data.stockPerf.length === 0 ? (
            <EmptyRow cols={5} />
          ) : (
            data.stockPerf.map((p) => (
              <tr key={p.productId} className="hover:bg-neutral-50/60">
                <Td mono>{p.sku}</Td>
                <Td>{p.name}</Td>
                <Td right mono>{p.inHand}</Td>
                <Td right mono>{p.sold30d}</Td>
                <Td right mono>{p.sellThrough}%</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>

      <SectionTitle>Recent Sales</SectionTitle>
      <TableWrap>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Customer</Th>
            <Th right>Total</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {data.recentSales.length === 0 ? (
            <EmptyRow cols={4} />
          ) : (
            data.recentSales.map((s) => (
              <tr key={s.id} className="hover:bg-neutral-50/60">
                <Td>{fmtDate(s.sold_on)}</Td>
                <Td>{s.customer_name ?? "—"}</Td>
                <Td right mono>{fmtMoney(s.total_cents)}</Td>
                <Td>{s.payment_status}</Td>
              </tr>
            ))
          )}
        </tbody>
      </TableWrap>

      {data.holdings.length > 0 && (
        <>
          <SectionTitle>My Holdings</SectionTitle>
          <TableWrap>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Product</Th>
                <Th>Branch</Th>
                <Th right>Qty</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.holdings.map((h) => (
                <tr key={`${h.branchId}-${h.productId}`} className="hover:bg-neutral-50/60">
                  <Td mono>{h.productSku}</Td>
                  <Td>{h.productName}</Td>
                  <Td>{h.branchName}</Td>
                  <Td right mono>{h.quantity}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}
    </>
  )
}

// ── INTERNAL_USE personal report ──────────────────────────────────────────────

function InternalUseReport({ data }: { data: Extract<ReportData, { kind: "internal_use" }> }) {
  const totalHeld = data.holdings.reduce((s, h) => s + h.quantity, 0)
  const usageMovements = data.holdingHistory.flatMap((p) =>
    p.movements
      .filter((m) => m.reason === "usage")
      .map((m) => ({ ...m, productName: p.productName, productSku: p.productSku })),
  ).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const holdingsChartData = [...data.holdings]
    .sort((a, b) => b.quantity - a.quantity)
    .map((h) => ({
      name: h.productName.length > 20 ? h.productName.slice(0, 18) + "…" : h.productName,
      qty: h.quantity,
    }))

  const usageByDate = new Map<string, number>()
  for (const m of usageMovements) {
    const d = m.createdAt.slice(0, 10)
    usageByDate.set(d, (usageByDate.get(d) ?? 0) + Math.abs(m.quantityDelta))
  }
  const usageTrend = [...usageByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, qty]) => ({ date: date.slice(5), qty }))

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="Products in Holding" value={data.holdings.length.toString()} delay={0.05} />
        <MetricCard label="Total Units Held" value={totalHeld.toLocaleString()} delay={0.1} />
        <MetricCard label="Pending Requests" value={data.pendingCount.toString()} delay={0.15} />
      </div>

      {(holdingsChartData.length > 0 || usageTrend.length > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {holdingsChartData.length > 0 && (
            <ChartCard title="My holdings by quantity" delay={0.2}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={holdingsChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval={0} angle={-20} textAnchor="end" height={40} />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v: unknown) => `${Number(v)} units`} />
                  <Bar dataKey="qty" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
          {usageTrend.length > 0 && (
            <ChartCard title="Consumption over time" delay={0.25}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={usageTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} formatter={(v: unknown) => `${Number(v)} units`} />
                  <Bar dataKey="qty" fill="#6d28d9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      {data.holdings.length > 0 && (
        <>
          <SectionTitle>My Holdings</SectionTitle>
          <TableWrap>
            <thead>
              <tr>
                <Th>SKU</Th>
                <Th>Product</Th>
                <Th>Branch</Th>
                <Th right>Qty</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.holdings.map((h) => (
                <tr key={`${h.branchId}-${h.productId}`} className="hover:bg-neutral-50/60">
                  <Td mono>{h.productSku}</Td>
                  <Td>{h.productName}</Td>
                  <Td>{h.branchName}</Td>
                  <Td right mono>{h.quantity}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}

      {usageMovements.length > 0 && (
        <>
          <SectionTitle>Products Consumed in Services</SectionTitle>
          <TableWrap>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Product</Th>
                <Th right>Qty Used</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {usageMovements.slice(0, 50).map((m) => (
                <tr key={m.id} className="hover:bg-neutral-50/60">
                  <Td>{fmtDate(m.createdAt)}</Td>
                  <Td>
                    <span className="font-medium">{m.productName}</span>
                    {m.productSku && <span className="ml-2 font-mono text-xs text-neutral-400">{m.productSku}</span>}
                  </Td>
                  <Td right mono>{Math.abs(m.quantityDelta)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}

      {data.myServiceRecords.length > 0 && (
        <>
          <SectionTitle>Services I Performed</SectionTitle>
          <TableWrap>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Service</Th>
                <Th>Customer</Th>
                <Th right>Fee</Th>
                <Th right>Products Used</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.myServiceRecords.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-50/60">
                  <Td>{fmtDate(r.performedOn)}</Td>
                  <Td>{r.serviceTypeName}</Td>
                  <Td>{r.customerName ?? "—"}</Td>
                  <Td right mono>{r.serviceFeeCents !== null ? fmtMoney(r.serviceFeeCents) : "—"}</Td>
                  <Td right mono>{r.consumptionCount}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}
    </>
  )
}

// ── Shared table components ───────────────────────────────────────────────────

function LedgerTable({ rows, showBranch }: { rows: OrgLedgerRow[]; showBranch?: boolean }) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>Date</Th>
          {showBranch && <Th>Branch</Th>}
          <Th>Product</Th>
          <Th>Movement</Th>
          <Th right>Δ Units</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {rows.length === 0 ? (
          <EmptyRow cols={showBranch ? 5 : 4} />
        ) : (
          rows.map((r) => (
            <tr key={r.id} className="hover:bg-neutral-50/60">
              <Td>{fmtDate(r.createdAt)}</Td>
              {showBranch && <Td>{r.branchName}</Td>}
              <Td>
                <span className="font-medium">{r.productName}</span>
                {r.productSku && <span className="ml-2 font-mono text-xs text-neutral-400">{r.productSku}</span>}
              </Td>
              <Td>{r.movementLabel}</Td>
              <Td right mono>
                <span className={r.quantityDelta >= 0 ? "text-emerald-600" : "text-red-600"}>
                  {r.quantityDelta >= 0 ? `+${r.quantityDelta}` : r.quantityDelta}
                </span>
              </Td>
            </tr>
          ))
        )}
      </tbody>
    </TableWrap>
  )
}

function LowStockTable({ rows }: { rows: ReportLowStock[] }) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>SKU</Th>
          <Th>Product</Th>
          <Th right>In Stock</Th>
          <Th right>Reorder At</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {rows.map((p) => (
          <tr key={p.id} className="bg-amber-50/40 hover:bg-amber-50/60">
            <Td mono>{p.sku}</Td>
            <Td>{p.name}</Td>
            <Td right mono>{p.quantity}</Td>
            <Td right mono>{p.reorder_point}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  )
}

function VendorTable({ vendors }: { vendors: ReportVendor[] }) {
  const sorted = [...vendors].sort((a, b) => b.outstanding_cents - a.outstanding_cents)
  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>Vendor</Th>
          <Th right>Outstanding</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {sorted.length === 0 ? (
          <EmptyRow cols={2} msg="No vendors" />
        ) : (
          sorted.map((v) => (
            <tr key={v.id} className="hover:bg-neutral-50/60">
              <Td>{v.name}</Td>
              <Td right mono>{v.outstanding_cents > 0 ? fmtMoney(v.outstanding_cents) : "—"}</Td>
            </tr>
          ))
        )}
      </tbody>
    </TableWrap>
  )
}

function HoldingsTable({ groups }: { groups: HolderGroup[] }) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>Holder</Th>
          <Th>Products</Th>
          <Th right>Total Units</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {groups.map((g) => (
          <tr key={g.holderUserId} className="hover:bg-neutral-50/60">
            <Td>
              <span className="font-medium">{g.holderName || g.holderEmail}</span>
              {g.holderName && <span className="ml-2 text-xs text-neutral-400">{g.holderEmail}</span>}
            </Td>
            <Td>{g.items.map((i) => i.productName).join(", ")}</Td>
            <Td right mono>{g.items.reduce((s, i) => s + i.quantity, 0)}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  )
}

function TransfersTable({ transfers }: { transfers: Transfer[] }) {
  return (
    <TableWrap>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>From</Th>
          <Th>To</Th>
          <Th>Status</Th>
          <Th>Initiated By</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {transfers.map((t) => (
          <tr key={t.id} className="hover:bg-neutral-50/60">
            <Td>{fmtDate(t.initiatedAt)}</Td>
            <Td>{t.sourceBranchName}</Td>
            <Td>{t.destBranchName}</Td>
            <Td>
              <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium",
                t.status === "received" ? "bg-emerald-50 text-emerald-700" :
                t.status === "in_transit" ? "bg-blue-50 text-blue-700" :
                "bg-neutral-100 text-neutral-500"
              )}>
                {t.status.replace("_", " ")}
              </span>
            </Td>
            <Td>{t.initiatedByLabel}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ReportView({ data }: { data: ReportData }) {
  const [period, setPeriod] = useState<"30d" | "all_time">("30d")

  const subtitle =
    data.kind === "org"
      ? data.orgName
      : data.kind === "branch"
      ? `${data.branchName} · ${data.orgName}`
      : data.kind === "inventory"
      ? data.branchName
      : data.kind === "sales" || data.kind === "internal_use"
      ? data.userName
      : ""

  return (
    <div className="pb-16">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        className="mb-8 flex items-start justify-between"
      >
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Report</h1>
          <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {data.kind === "org" && <PeriodToggle period={period} onChange={setPeriod} />}
          <DownloadButton data={data} />
        </div>
      </motion.div>

      {data.kind === "org" && <OrgReport data={data} period={period} />}
      {data.kind === "branch" && <BranchReport data={data} />}
      {data.kind === "inventory" && <InventoryReport data={data} />}
      {data.kind === "sales" && <SalesReport data={data} />}
      {data.kind === "internal_use" && <InternalUseReport data={data} />}
    </div>
  )
}
