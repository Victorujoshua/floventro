import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

// ── Types ─────────────────────────────────────────────────────────────────────

export type BranchSummary = {
  id: string
  name: string
  address: string | null
  revenueLast30dCents: number
  stockUnits: number
}

export type OrgOverview = {
  revenueLast30dCents: number
  revenueAllTimeCents: number
  totalStockUnits: number
  pendingRequestCount: number
  outstandingCents: number
  lowStockCount: number
  branches: BranchSummary[]
}

export type OrgBranchRevenue = {
  branchId: string
  branchName: string
  revenueCents: number
  // null when no sold products in this branch have vendor invoice cost data
  profitCents: number | null
}

export type OrgProductPerf = {
  productId: string
  productName: string
  productSku: string
  qtySold: number
  revenueCents: number
  // null when this product has no vendor_invoice_lines → cost unknown
  costCents: number | null
  marginPct: number | null
}

export type OrgRecentSale = {
  id: string
  soldOn: string
  branchId: string
  branchName: string
  customerName: string | null
  totalCents: number
  createdAt: string
}

export type OrgSalesData = {
  revenueAllTimeCents: number
  revenueLast30dCents: number
  // null when no products sold in the 30d period have vendor invoice cost data
  profitLast30dCents: number | null
  avgMarginPct: number | null
  // true when every product sold in 30d has a known cost
  costDataComplete: boolean
  // distinct product count sold in 30d that lack vendor invoice history
  missingCostProductCount: number
  branchRevenue: OrgBranchRevenue[]
  productPerformance: OrgProductPerf[]
  recentSales: OrgRecentSale[]
}

export type OrgLedgerRow = {
  id: string
  createdAt: string
  productName: string
  productSku: string
  branchName: string
  reason: string
  quantityDelta: number
  movementLabel: string
  note: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function since30dCutoff(): string {
  return new Date(Date.now() - 30 * 86_400_000).toISOString()
}

function resolveMovementLabel(reason: string, adjReason: string | null): string {
  switch (reason) {
    case "vendor_invoice":     return "Received from vendor"
    case "request_fulfilment": return "Issued via request"
    case "adjustment":         return `Adjustment · ${adjReason ?? ""}`
    case "issue_to_holding":   return "Issued to holding"
    case "return_to_branch":   return "Returned from holding"
    case "return_receipt":     return "Return received"
    case "sale":               return "Sold from holding"
    case "usage":              return "Used in service"
    case "transfer_in":        return "Transfer in"
    case "transfer_out":       return "Transfer out"
    case "reversal":           return "Reversal"
    default:                   return reason
  }
}

/**
 * Builds a per-product weighted-average unit cost (in cents) from all
 * vendor_invoice_lines in the org.
 *
 * Products NOT returned → cost is UNKNOWN (null), NOT zero.
 * This is the only honest cost source: products added via adjustment (opening
 * stock) have no invoice line and therefore no cost data.
 * TODO: capture optional cost on opening-stock adjustments when needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchOrgCostMap(supabase: any, organisationId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("vendor_invoices")
    .select("vendor_invoice_lines(product_id, quantity, unit_cost_cents)")
    .eq("organisation_id", organisationId)
    .is("deleted_at", null)

  if (error || !data) return new Map()

  type RawLine = { product_id: string; quantity: number; unit_cost_cents: number }
  type RawInvoice = { vendor_invoice_lines: RawLine[] }

  // Accumulate (totalCostCents, totalQty) per product across all invoices
  const perProduct = new Map<string, { totalCostCents: number; totalQty: number }>()
  for (const inv of (data as unknown as RawInvoice[])) {
    for (const line of inv.vendor_invoice_lines ?? []) {
      const existing = perProduct.get(line.product_id)
      if (existing) {
        existing.totalCostCents += line.unit_cost_cents * line.quantity
        existing.totalQty += line.quantity
      } else {
        perProduct.set(line.product_id, {
          totalCostCents: line.unit_cost_cents * line.quantity,
          totalQty: line.quantity,
        })
      }
    }
  }

  // Compute weighted average: totalCostCents / totalQty
  const result = new Map<string, number>()
  for (const [productId, { totalCostCents, totalQty }] of perProduct) {
    if (totalQty > 0) {
      result.set(productId, totalCostCents / totalQty)
    }
  }
  return result
}

// ── getOrgOverview ────────────────────────────────────────────────────────────

const EMPTY_OVERVIEW: OrgOverview = {
  revenueLast30dCents: 0,
  revenueAllTimeCents: 0,
  totalStockUnits: 0,
  pendingRequestCount: 0,
  outstandingCents: 0,
  lowStockCount: 0,
  branches: [],
}

export async function getOrgOverview(): Promise<OrgOverview> {
  const scope = await getCurrentScope()
  if (!scope) return EMPTY_OVERVIEW

  const supabase = await createAppServerClient()
  const cutoff = since30dCutoff()

  const [branchRes, salesRes, productRes, requestRes, invoiceRes] = await Promise.all([
    supabase
      .from("branches")
      .select("id, name, address")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)
      .order("name"),

    supabase
      .from("sales")
      .select("branch_id, total_cents, created_at")
      .eq("organisation_id", scope.organisationId),

    supabase
      .from("products")
      .select("reorder_point, product_stock(branch_id, quantity)")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null),

    supabase
      .from("stock_requests")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", scope.organisationId)
      .eq("status", "pending")
      .is("deleted_at", null),

    supabase
      .from("vendor_invoices")
      .select("total_cents, amount_paid_cents")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)
      .in("status", ["unpaid", "partial"]),
  ])

  // ── Revenue aggregation ───────────────────────────────────────────────────
  type RawSale = { branch_id: string; total_cents: number; created_at: string }
  const sales = (salesRes.data ?? []) as unknown as RawSale[]

  let revenueAllTimeCents = 0
  let revenueLast30dCents = 0
  const branchRevMap = new Map<string, number>()

  for (const s of sales) {
    revenueAllTimeCents += s.total_cents
    if (s.created_at >= cutoff) {
      revenueLast30dCents += s.total_cents
      branchRevMap.set(s.branch_id, (branchRevMap.get(s.branch_id) ?? 0) + s.total_cents)
    }
  }

  // ── Stock aggregation ─────────────────────────────────────────────────────
  type RawProductStock = { branch_id: string; quantity: number }
  type RawProduct = { reorder_point: number; product_stock: RawProductStock[] }
  const products = (productRes.data ?? []) as unknown as RawProduct[]

  let totalStockUnits = 0
  let lowStockCount = 0
  const branchStockMap = new Map<string, number>()

  for (const p of products) {
    const stocks = p.product_stock ?? []
    const totalQty = stocks.reduce((s, r) => s + r.quantity, 0)
    totalStockUnits += totalQty
    if (p.reorder_point > 0 && totalQty <= p.reorder_point) lowStockCount++
    for (const s of stocks) {
      branchStockMap.set(s.branch_id, (branchStockMap.get(s.branch_id) ?? 0) + s.quantity)
    }
  }

  // ── Payables aggregation ──────────────────────────────────────────────────
  type RawInvoice = { total_cents: number; amount_paid_cents: number }
  const invoices = (invoiceRes.data ?? []) as unknown as RawInvoice[]
  const outstandingCents = invoices.reduce((s, i) => s + i.total_cents - i.amount_paid_cents, 0)

  // ── Branch summaries ──────────────────────────────────────────────────────
  type RawBranch = { id: string; name: string; address: string | null }
  const branches: BranchSummary[] = ((branchRes.data ?? []) as unknown as RawBranch[]).map((b) => ({
    id: b.id,
    name: b.name,
    address: b.address,
    revenueLast30dCents: branchRevMap.get(b.id) ?? 0,
    stockUnits: branchStockMap.get(b.id) ?? 0,
  }))

  return {
    revenueLast30dCents,
    revenueAllTimeCents,
    totalStockUnits,
    pendingRequestCount: requestRes.count ?? 0,
    outstandingCents,
    lowStockCount,
    branches,
  }
}

// ── getOrgSales ───────────────────────────────────────────────────────────────

const EMPTY_ORG_SALES: OrgSalesData = {
  revenueAllTimeCents: 0,
  revenueLast30dCents: 0,
  profitLast30dCents: null,
  avgMarginPct: null,
  costDataComplete: false,
  missingCostProductCount: 0,
  branchRevenue: [],
  productPerformance: [],
  recentSales: [],
}

export async function getOrgSales(): Promise<OrgSalesData> {
  const scope = await getCurrentScope()
  if (!scope) return EMPTY_ORG_SALES

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any
  const cutoff = since30dCutoff()

  // Run all three data sources in parallel.
  const [salesRes, branchRes, costMap] = await Promise.all([
    supabase
      .from("sales")
      .select(
        "id, branch_id, total_cents, created_at, sold_on, customer_name, sale_lines(product_id, quantity, line_total_cents, products(id, name, sku))",
      )
      .eq("organisation_id", scope.organisationId)
      .order("created_at", { ascending: false }),

    supabase
      .from("branches")
      .select("id, name")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null),

    fetchOrgCostMap(supabase, scope.organisationId),
  ])

  type RawLineProduct = { id: string; name: string; sku: string }
  type RawLine = {
    product_id: string
    quantity: number
    line_total_cents: number
    products: RawLineProduct | RawLineProduct[] | null
  }
  type RawSale = {
    id: string
    branch_id: string
    total_cents: number
    created_at: string
    sold_on: string
    customer_name: string | null
    sale_lines: RawLine[]
  }
  type RawBranch = { id: string; name: string }

  const sales = (salesRes.data ?? []) as unknown as RawSale[]

  const branchMap = new Map<string, string>()
  for (const b of (branchRes.data ?? []) as unknown as RawBranch[]) {
    branchMap.set(b.id, b.name)
  }

  // ── Aggregation pass ──────────────────────────────────────────────────────

  let revenueAllTimeCents = 0
  let revenueLast30dCents = 0

  // For 30d profit: track revenue and cost only over lines with known cost.
  let revenueLast30dKnownCostCents = 0
  let costLast30dKnownCents = 0
  let hasAny30dCostData = false
  const missingCostProductIds = new Set<string>()

  // Per-branch last-30d aggregation.
  // hasAnyCostData: true if at least one sold line in this branch had known cost.
  const branchAgg = new Map<
    string,
    { revenueCents: number; knownCostCents: number; hasAnyCostData: boolean }
  >()

  // Per-product ALL-TIME aggregation.
  type ProdAgg = {
    name: string
    sku: string
    qtySold: number
    revenueCents: number
    // null when this product has no entry in costMap (no purchase history)
    costCents: number | null
  }
  const productAgg = new Map<string, ProdAgg>()

  for (const sale of sales) {
    revenueAllTimeCents += sale.total_cents
    const isLast30d = sale.created_at >= cutoff

    if (isLast30d) {
      revenueLast30dCents += sale.total_cents
      if (!branchAgg.has(sale.branch_id)) {
        branchAgg.set(sale.branch_id, { revenueCents: 0, knownCostCents: 0, hasAnyCostData: false })
      }
      branchAgg.get(sale.branch_id)!.revenueCents += sale.total_cents
    }

    for (const line of sale.sale_lines ?? []) {
      const prod = Array.isArray(line.products) ? line.products[0] : line.products
      const avgCost = costMap.get(line.product_id)    // undefined = cost unknown
      const hasCost = avgCost !== undefined
      const lineCost = hasCost ? line.quantity * avgCost! : null

      // ── Product performance (all time) ──────────────────────────────────
      const existing = productAgg.get(line.product_id)
      if (existing) {
        existing.qtySold += line.quantity
        existing.revenueCents += line.line_total_cents
        if (existing.costCents !== null && lineCost !== null) {
          existing.costCents += lineCost
        }
        // If the product already had costCents = null, it stays null.
      } else {
        productAgg.set(line.product_id, {
          name: (prod as RawLineProduct | null)?.name ?? "Unknown",
          sku: (prod as RawLineProduct | null)?.sku ?? "",
          qtySold: line.quantity,
          revenueCents: line.line_total_cents,
          costCents: hasCost ? (lineCost ?? 0) : null,
        })
      }

      // ── 30d cost aggregation ─────────────────────────────────────────────
      if (isLast30d) {
        if (hasCost && lineCost !== null) {
          revenueLast30dKnownCostCents += line.line_total_cents
          costLast30dKnownCents += lineCost
          hasAny30dCostData = true
          const ba = branchAgg.get(sale.branch_id)
          if (ba) {
            ba.knownCostCents += lineCost
            ba.hasAnyCostData = true
          }
        } else {
          missingCostProductIds.add(line.product_id)
        }
      }
    }
  }

  // ── Derived metrics ───────────────────────────────────────────────────────

  const profitLast30dCents = hasAny30dCostData
    ? revenueLast30dKnownCostCents - costLast30dKnownCents
    : null

  const avgMarginPct =
    hasAny30dCostData && revenueLast30dKnownCostCents > 0
      ? Math.round((profitLast30dCents! / revenueLast30dKnownCostCents) * 1000) / 10
      : null

  const costDataComplete = hasAny30dCostData && missingCostProductIds.size === 0
  const missingCostProductCount = missingCostProductIds.size

  // ── Build output arrays ───────────────────────────────────────────────────

  const branchRevenue: OrgBranchRevenue[] = ((branchRes.data ?? []) as unknown as RawBranch[])
    .map((b) => {
      const agg = branchAgg.get(b.id)
      return {
        branchId: b.id,
        branchName: b.name,
        revenueCents: agg?.revenueCents ?? 0,
        profitCents: agg?.hasAnyCostData
          ? (agg.revenueCents - agg.knownCostCents)
          : null,
      }
    })
    .sort((a, b) => b.revenueCents - a.revenueCents)

  const productPerformance: OrgProductPerf[] = [...productAgg.entries()]
    .map(([id, pa]) => ({
      productId: id,
      productName: pa.name,
      productSku: pa.sku,
      qtySold: pa.qtySold,
      revenueCents: pa.revenueCents,
      costCents: pa.costCents,
      marginPct:
        pa.costCents !== null && pa.revenueCents > 0
          ? Math.round(((pa.revenueCents - pa.costCents) / pa.revenueCents) * 1000) / 10
          : null,
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 20)

  const recentSales: OrgRecentSale[] = sales.slice(0, 30).map((s) => ({
    id: s.id,
    soldOn: s.sold_on,
    branchId: s.branch_id,
    branchName: branchMap.get(s.branch_id) ?? "—",
    customerName: s.customer_name,
    totalCents: s.total_cents,
    createdAt: s.created_at,
  }))

  return {
    revenueAllTimeCents,
    revenueLast30dCents,
    profitLast30dCents,
    avgMarginPct,
    costDataComplete,
    missingCostProductCount,
    branchRevenue,
    productPerformance,
    recentSales,
  }
}

// ── getOrgLedger ──────────────────────────────────────────────────────────────

export async function getOrgLedger(limit = 100): Promise<OrgLedgerRow[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("stock_ledger")
    .select("id, created_at, quantity_delta, reason, adjustment_reason, note, branch_id, product_id")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error || !data) return []

  type RawRow = {
    id: string
    created_at: string
    quantity_delta: number
    reason: string
    adjustment_reason: string | null
    note: string | null
    branch_id: string | null
    product_id: string | null
  }

  const rows = data as unknown as RawRow[]

  // Batch-resolve branch names
  const branchIds = [...new Set(rows.filter((r) => r.branch_id).map((r) => r.branch_id!))]
  const branchNameMap = new Map<string, string>()
  if (branchIds.length > 0) {
    const { data: branches } = await supabase
      .from("branches")
      .select("id, name")
      .in("id", branchIds)
    for (const b of (branches ?? []) as { id: string; name: string }[]) {
      branchNameMap.set(b.id, b.name)
    }
  }

  // Batch-resolve product names
  const productIds = [...new Set(rows.filter((r) => r.product_id).map((r) => r.product_id!))]
  const productNameMap = new Map<string, { name: string; sku: string }>()
  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from("products")
      .select("id, name, sku")
      .in("id", productIds)
    for (const p of (products ?? []) as { id: string; name: string; sku: string }[]) {
      productNameMap.set(p.id, { name: p.name, sku: p.sku })
    }
  }

  return rows.map((row) => {
    const product = row.product_id ? productNameMap.get(row.product_id) : null
    return {
      id: row.id,
      createdAt: row.created_at,
      productName: product?.name ?? "—",
      productSku: product?.sku ?? "",
      branchName: row.branch_id ? (branchNameMap.get(row.branch_id) ?? "—") : "—",
      reason: row.reason,
      quantityDelta: row.quantity_delta,
      movementLabel: resolveMovementLabel(row.reason, row.adjustment_reason),
      note: row.note,
    }
  })
}
