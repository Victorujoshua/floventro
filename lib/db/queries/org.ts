import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

// ── Types ─────────────────────────────────────────────────────────────────────

export type BranchSummary = {
  id: string
  name: string
  // address removed — column does not exist in branches table (Option B)
  revenueLast30dCents: number
  stockUnits: number
}

export type OrgOverview = {
  revenueLast30dCents: number
  revenueAllTimeCents: number
  profitLast30dCents: number | null
  avgMarginPct: number | null
  costDataComplete: boolean
  missingCostProductCount: number
  // Pool stock + staff holdings + in-transit
  totalStockUnits: number
  // Breakdown for the card subtitle
  poolStockUnits: number
  heldByStaffUnits: number
  inTransitUnits: number
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

// ── getOrgOverview ────────────────────────────────────────────────────────────

export async function getOrgOverview(): Promise<OrgOverview> {
  const scope = await getCurrentScope()
  if (!scope) throw new Error("No active scope — unauthenticated or missing membership")

  const supabase = await createAppServerClient()
  const cutoff = since30dCutoff()

  // Run all queries in parallel. Errors are checked below before any processing.
  const [branchRes, salesRes, productRes, requestRes, invoiceRes, staffRes, transferRes, cogsRes] =
    await Promise.all([
      // Bug 1 fix: select only columns that actually exist (no `address`)
      supabase
        .from("branches")
        .select("id, name")
        .eq("organisation_id", scope.organisationId)
        .is("deleted_at", null)
        .order("name"),

      supabase
        .from("sales")
        .select("branch_id, total_cents, created_at, sale_lines(id, product_id, line_total_cents)")
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

      // Bug 2 fix: staff_holdings org-wide sum
      // staff_holdings has organisation_id directly (see app_0022_staff_holdings.sql).
      // RLS: owner can read all holdings via user_vendor_write_branch_ids() which
      // returns all non-deleted branches for their org.
      supabase
        .from("staff_holdings")
        .select("quantity")
        .eq("organisation_id", scope.organisationId),

      // Bug 2 fix: in-transit stock
      // stock_transfers has organisation_id; nested select pulls transfer lines.
      // RLS: owner can read all transfers via user_vendor_read_branch_ids().
      supabase
        .from("stock_transfers")
        .select("stock_transfer_lines(quantity_sent, quantity_received)")
        .eq("organisation_id", scope.organisationId)
        .eq("status", "in_transit"),

      // Frozen COGS per sale_line — written at sale time.
      // Pre-migration sale_lines have no row here → treated as unknown cost.
      supabase
        .from("cogs_allocations")
        .select("reference_id, cogs_cents, cost_known")
        .eq("organisation_id", scope.organisationId)
        .eq("reference_type", "sale_line"),
    ])

  // Bug 3 fix: check errors explicitly — never let a failed query masquerade
  // as empty data. Throw so Next.js shows an error boundary instead of "0 branches".
  if (branchRes.error) {
    console.error("[getOrgOverview] branches query failed", branchRes.error)
    throw branchRes.error
  }
  if (salesRes.error) {
    console.error("[getOrgOverview] sales query failed", salesRes.error)
    throw salesRes.error
  }
  if (productRes.error) {
    console.error("[getOrgOverview] products query failed", productRes.error)
    throw productRes.error
  }
  if (requestRes.error) {
    console.error("[getOrgOverview] stock_requests query failed", requestRes.error)
    throw requestRes.error
  }
  if (invoiceRes.error) {
    console.error("[getOrgOverview] vendor_invoices query failed", invoiceRes.error)
    throw invoiceRes.error
  }
  if (staffRes.error) {
    console.error("[getOrgOverview] staff_holdings query failed", staffRes.error)
    throw staffRes.error
  }
  if (transferRes.error) {
    console.error("[getOrgOverview] stock_transfers query failed", transferRes.error)
    throw transferRes.error
  }
  if (cogsRes.error) {
    console.error("[getOrgOverview] cogs_allocations query failed", cogsRes.error)
    throw cogsRes.error
  }

  // ── COGS map ──────────────────────────────────────────────────────────────
  type RawCogs = { reference_id: string; cogs_cents: number | null; cost_known: boolean }
  const cogsMap = new Map<string, { cogsCents: number | null; costKnown: boolean }>()
  for (const alloc of (cogsRes.data as unknown as RawCogs[]) ?? []) {
    cogsMap.set(alloc.reference_id, { cogsCents: alloc.cogs_cents, costKnown: alloc.cost_known })
  }

  // ── Revenue + 30d COGS aggregation ───────────────────────────────────────
  type RawSaleLine = { id: string; product_id: string; line_total_cents: number }
  type RawSale = { branch_id: string; total_cents: number; created_at: string; sale_lines: RawSaleLine[] }
  const sales = salesRes.data as unknown as RawSale[]

  let revenueAllTimeCents = 0
  let revenueLast30dCents = 0
  let revenueLast30dKnownCostCents = 0
  let costLast30dKnownCents = 0
  let hasAny30dCostData = false
  const missingCostProductIds = new Set<string>()
  const branchRevMap = new Map<string, number>()

  for (const s of sales) {
    revenueAllTimeCents += s.total_cents
    if (s.created_at >= cutoff) {
      revenueLast30dCents += s.total_cents
      branchRevMap.set(s.branch_id, (branchRevMap.get(s.branch_id) ?? 0) + s.total_cents)

      for (const line of s.sale_lines ?? []) {
        const alloc = cogsMap.get(line.id)
        const hasCost = alloc?.costKnown === true
        const lineCost = hasCost ? (alloc!.cogsCents ?? null) : null
        if (hasCost && lineCost !== null) {
          revenueLast30dKnownCostCents += line.line_total_cents
          costLast30dKnownCents += lineCost
          hasAny30dCostData = true
        } else {
          missingCostProductIds.add(line.product_id)
        }
      }
    }
  }

  const profitLast30dCents = hasAny30dCostData
    ? revenueLast30dKnownCostCents - costLast30dKnownCents
    : null
  const avgMarginPct =
    hasAny30dCostData && revenueLast30dKnownCostCents > 0
      ? Math.round((profitLast30dCents! / revenueLast30dKnownCostCents) * 1000) / 10
      : null
  const costDataComplete = hasAny30dCostData && missingCostProductIds.size === 0
  const missingCostProductCount = missingCostProductIds.size

  // ── Branch pool stock aggregation ─────────────────────────────────────────
  type RawProductStock = { branch_id: string; quantity: number }
  type RawProduct = { reorder_point: number; product_stock: RawProductStock[] }
  const products = productRes.data as unknown as RawProduct[]

  let poolStockUnits = 0
  let lowStockCount = 0
  const branchStockMap = new Map<string, number>()

  for (const p of products) {
    const stocks = p.product_stock ?? []
    const totalQty = stocks.reduce((s, r) => s + r.quantity, 0)
    poolStockUnits += totalQty
    if (p.reorder_point > 0 && totalQty <= p.reorder_point) lowStockCount++
    for (const s of stocks) {
      branchStockMap.set(s.branch_id, (branchStockMap.get(s.branch_id) ?? 0) + s.quantity)
    }
  }

  // ── Staff holdings sum ────────────────────────────────────────────────────
  type RawHolding = { quantity: number }
  const heldByStaffUnits = (staffRes.data as unknown as RawHolding[]).reduce(
    (sum, h) => sum + h.quantity,
    0,
  )

  // ── In-transit sum ────────────────────────────────────────────────────────
  // Each in-transit transfer line: in-transit = quantity_sent − coalesce(quantity_received, 0)
  type RawTransferLine = { quantity_sent: number; quantity_received: number | null }
  type RawTransfer = { stock_transfer_lines: RawTransferLine[] }
  let inTransitUnits = 0
  for (const t of (transferRes.data as unknown as RawTransfer[])) {
    for (const line of t.stock_transfer_lines ?? []) {
      inTransitUnits += line.quantity_sent - (line.quantity_received ?? 0)
    }
  }

  const totalStockUnits = poolStockUnits + heldByStaffUnits + inTransitUnits

  // ── Payables aggregation ──────────────────────────────────────────────────
  type RawInvoice = { total_cents: number; amount_paid_cents: number }
  const invoices = invoiceRes.data as unknown as RawInvoice[]
  const outstandingCents = invoices.reduce((s, i) => s + i.total_cents - i.amount_paid_cents, 0)

  // ── Branch summaries ──────────────────────────────────────────────────────
  type RawBranch = { id: string; name: string }
  const branches: BranchSummary[] = (branchRes.data as unknown as RawBranch[]).map((b) => ({
    id: b.id,
    name: b.name,
    revenueLast30dCents: branchRevMap.get(b.id) ?? 0,
    stockUnits: branchStockMap.get(b.id) ?? 0,
  }))

  return {
    revenueLast30dCents,
    revenueAllTimeCents,
    profitLast30dCents,
    avgMarginPct,
    costDataComplete,
    missingCostProductCount,
    totalStockUnits,
    poolStockUnits,
    heldByStaffUnits,
    inTransitUnits,
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

  const [salesRes, branchRes, cogsRes] = await Promise.all([
    supabase
      .from("sales")
      .select(
        "id, branch_id, total_cents, created_at, sold_on, customer_name, sale_lines(id, product_id, quantity, line_total_cents, products(id, name, sku))",
      )
      .eq("organisation_id", scope.organisationId)
      .order("created_at", { ascending: false }),

    supabase
      .from("branches")
      .select("id, name")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null),

    // Frozen COGS per sale_line — written at sale time, never retroactively updated.
    // Pre-migration sale_lines have no row here → treated as unknown cost.
    supabase
      .from("cogs_allocations")
      .select("reference_id, cogs_cents, cost_known")
      .eq("organisation_id", scope.organisationId)
      .eq("reference_type", "sale_line"),
  ])

  if (salesRes.error) {
    console.error("[getOrgSales] sales query failed", salesRes.error)
    throw salesRes.error
  }
  if (branchRes.error) {
    console.error("[getOrgSales] branches query failed", branchRes.error)
    throw branchRes.error
  }
  if (cogsRes.error) {
    console.error("[getOrgSales] cogs_allocations query failed", cogsRes.error)
    throw cogsRes.error
  }

  // sale_line_id → frozen COGS (immutable after the sale is recorded).
  type RawCogs = { reference_id: string; cogs_cents: number | null; cost_known: boolean }
  const cogsMap = new Map<string, { cogsCents: number | null; costKnown: boolean }>()
  for (const alloc of (cogsRes.data as unknown as RawCogs[]) ?? []) {
    cogsMap.set(alloc.reference_id, { cogsCents: alloc.cogs_cents, costKnown: alloc.cost_known })
  }

  type RawLineProduct = { id: string; name: string; sku: string }
  type RawLine = {
    id: string
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

  const sales = salesRes.data as unknown as RawSale[]

  const branchMap = new Map<string, string>()
  for (const b of branchRes.data as unknown as RawBranch[]) {
    branchMap.set(b.id, b.name)
  }

  // ── Aggregation pass ──────────────────────────────────────────────────────

  let revenueAllTimeCents = 0
  let revenueLast30dCents = 0

  let revenueLast30dKnownCostCents = 0
  let costLast30dKnownCents = 0
  let hasAny30dCostData = false
  const missingCostProductIds = new Set<string>()

  const branchAgg = new Map<
    string,
    { revenueCents: number; knownCostCents: number; hasAnyCostData: boolean }
  >()

  type ProdAgg = {
    name: string
    sku: string
    qtySold: number
    revenueCents: number
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

      // Frozen COGS from cogs_allocations — immutable after the sale is recorded.
      // A new vendor receipt after this sale does NOT change this number.
      // No allocation row (pre-migration sale) → unknown cost.
      const alloc = cogsMap.get(line.id)
      const hasCost = alloc?.costKnown === true
      const lineCost: number | null = hasCost ? (alloc!.cogsCents ?? null) : null

      const existing = productAgg.get(line.product_id)
      if (existing) {
        existing.qtySold += line.quantity
        existing.revenueCents += line.line_total_cents
        if (existing.costCents !== null && lineCost !== null) {
          existing.costCents += lineCost
        } else if (lineCost === null) {
          // Any unknown-cost line taints the product's cost display entirely.
          existing.costCents = null
        }
      } else {
        productAgg.set(line.product_id, {
          name: (prod as RawLineProduct | null)?.name ?? "Unknown",
          sku: (prod as RawLineProduct | null)?.sku ?? "",
          qtySold: line.quantity,
          revenueCents: line.line_total_cents,
          costCents: lineCost,
        })
      }

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

  const profitLast30dCents = hasAny30dCostData
    ? revenueLast30dKnownCostCents - costLast30dKnownCents
    : null

  const avgMarginPct =
    hasAny30dCostData && revenueLast30dKnownCostCents > 0
      ? Math.round((profitLast30dCents! / revenueLast30dKnownCostCents) * 1000) / 10
      : null

  const costDataComplete = hasAny30dCostData && missingCostProductIds.size === 0
  const missingCostProductCount = missingCostProductIds.size

  const branchRevenue: OrgBranchRevenue[] = (branchRes.data as unknown as RawBranch[])
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
    .eq("organisation_id", scope.organisationId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[getOrgLedger] stock_ledger query failed", error)
    throw error
  }

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

  const branchIds = [...new Set(rows.filter((r) => r.branch_id).map((r) => r.branch_id!))]
  const branchNameMap = new Map<string, string>()
  if (branchIds.length > 0) {
    const { data: branches, error: branchErr } = await supabase
      .from("branches")
      .select("id, name")
      .in("id", branchIds)
    if (branchErr) {
      console.error("[getOrgLedger] branch name lookup failed", branchErr)
      throw branchErr
    }
    for (const b of (branches ?? []) as { id: string; name: string }[]) {
      branchNameMap.set(b.id, b.name)
    }
  }

  const productIds = [...new Set(rows.filter((r) => r.product_id).map((r) => r.product_id!))]
  const productNameMap = new Map<string, { name: string; sku: string }>()
  if (productIds.length > 0) {
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id, name, sku")
      .in("id", productIds)
    if (prodErr) {
      console.error("[getOrgLedger] product name lookup failed", prodErr)
      throw prodErr
    }
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
