"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"

export type ImportResult = {
  imported: number
  skipped:  { row: number; reason: string }[]
  warnings: { row: number; note: string }[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Clients ───────────────────────────────────────────────────────────────────

export async function importClientsAction(
  rows: Record<string, unknown>[],
): Promise<ImportResult> {
  const scope  = await requireRole("owner", "inventory", "admin", "sales")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return { imported: 0, skipped: [], warnings: [] }

  // Pre-fetch existing member_ids for dedup
  const { data: existing } = await supabase
    .from("clients")
    .select("member_id")
    .eq("organisation_id", scope.organisationId)
    .not("member_id", "is", null)

  const existingMemberIds = new Set<string>(
    (existing ?? []).map((c: { member_id: string }) => c.member_id),
  )

  let imported = 0
  const skipped:  ImportResult["skipped"]  = []
  const warnings: ImportResult["warnings"] = []

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2
    const row    = rows[i]

    const name = String(row.name ?? "").trim()
    if (!name) {
      skipped.push({ row: rowNum, reason: "name is required" })
      continue
    }

    const email = String(row.email ?? "").trim() || null
    if (email && !EMAIL_RE.test(email)) {
      skipped.push({ row: rowNum, reason: `invalid email "${email}"` })
      continue
    }

    const memberId = String(row.member_id ?? "").trim() || null
    if (memberId && existingMemberIds.has(memberId)) {
      skipped.push({ row: rowNum, reason: `duplicate member_id "${memberId}"` })
      continue
    }

    const { error } = await supabase
      .from("clients")
      .insert({
        organisation_id: scope.organisationId,
        name,
        phone:      String(row.phone ?? "").trim()    || null,
        email,
        member_id:  memberId,
        created_by: authData.user.id,
      })

    if (error) {
      if (error.code === "23505") {
        skipped.push({ row: rowNum, reason: `duplicate member_id "${memberId ?? ""}"` })
      } else {
        skipped.push({ row: rowNum, reason: "database error — contact support" })
        console.error("[importClientsAction] row", rowNum, error)
      }
      continue
    }

    if (memberId) existingMemberIds.add(memberId)
    imported++
  }

  return { imported, skipped, warnings }
}

// ── Services ──────────────────────────────────────────────────────────────────

export async function importServicesAction(
  rows: Record<string, unknown>[],
): Promise<ImportResult> {
  const scope    = await requireRole("owner", "inventory", "admin", "sales")
  const supabase = await createAppServerClient()

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return { imported: 0, skipped: [], warnings: [] }

  // Pre-fetch existing service names for dedup
  const { data: existing } = await supabase
    .from("service_types")
    .select("name")
    .eq("organisation_id", scope.organisationId)

  const existingNames = new Set<string>(
    (existing ?? []).map((s: { name: string }) => s.name.toLowerCase()),
  )

  let imported = 0
  const skipped:  ImportResult["skipped"]  = []
  const warnings: ImportResult["warnings"] = []

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2
    const row    = rows[i]

    const name = String(row.name ?? "").trim()
    if (!name) {
      skipped.push({ row: rowNum, reason: "name is required" })
      continue
    }

    if (existingNames.has(name.toLowerCase())) {
      skipped.push({ row: rowNum, reason: `service "${name}" already exists` })
      continue
    }

    const priceNaira = Number(row.default_price_naira ?? 0)
    if (isNaN(priceNaira) || priceNaira < 0) {
      skipped.push({ row: rowNum, reason: "default_price_naira must be a non-negative number" })
      continue
    }

    const isActiveRaw = row.is_active
    const isActive =
      isActiveRaw === false ||
      isActiveRaw === 0    ||
      String(isActiveRaw).toLowerCase() === "false"
        ? false
        : true

    const { error } = await supabase
      .from("service_types")
      .insert({
        organisation_id:     scope.organisationId,
        name,
        description:         null,
        default_price_cents: Math.round(priceNaira * 100),
        is_active:           isActive,
        created_by:          authData.user.id,
      })

    if (error) {
      if (error.code === "23505") {
        skipped.push({ row: rowNum, reason: `service "${name}" already exists` })
      } else {
        skipped.push({ row: rowNum, reason: "database error — contact support" })
        console.error("[importServicesAction] row", rowNum, error)
      }
      continue
    }

    existingNames.add(name.toLowerCase())
    imported++
  }

  return { imported, skipped, warnings }
}

// ── Service items ─────────────────────────────────────────────────────────────

const VALID_CATEGORIES = new Set(["product", "supply", "equipment"])

export async function importServiceItemsAction(
  rows: Record<string, unknown>[],
): Promise<ImportResult> {
  const scope = await requireRole("owner", "inventory", "admin", "sales")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return { imported: 0, skipped: [], warnings: [] }

  // Pre-fetch measurements (system + org-specific)
  const { data: measurements } = await supabase
    .from("measurements")
    .select("id, name, symbol")
    .or(`organisation_id.is.null,organisation_id.eq.${scope.organisationId}`)

  // Map both symbol and name → id (symbol takes priority on insert order)
  const measurementByKey = new Map<string, string>()
  for (const m of measurements ?? []) {
    if (m.name)   measurementByKey.set((m.name   as string).toLowerCase(), m.id as string)
    if (m.symbol) measurementByKey.set((m.symbol as string).toLowerCase(), m.id as string)
  }

  // Pre-fetch products for name → id lookup
  const { data: products } = await supabase
    .from("products")
    .select("id, name")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)

  const productByName = new Map<string, string>()
  for (const p of products ?? []) {
    productByName.set((p.name as string).toLowerCase(), p.id as string)
  }

  let imported = 0
  const skipped:  ImportResult["skipped"]  = []
  const warnings: ImportResult["warnings"] = []

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2
    const row    = rows[i]

    const name = String(row.name ?? "").trim()
    if (!name) {
      skipped.push({ row: rowNum, reason: "name is required" })
      continue
    }

    const category = String(row.category ?? "").trim().toLowerCase()
    if (!VALID_CATEGORIES.has(category)) {
      skipped.push({
        row: rowNum,
        reason: `invalid category "${category}" — must be product, supply, or equipment`,
      })
      continue
    }

    const amountNaira = Number(row.amount_naira ?? NaN)
    if (isNaN(amountNaira) || amountNaira < 0) {
      skipped.push({ row: rowNum, reason: "amount_naira must be a non-negative number" })
      continue
    }

    const measurementStr = String(row.measurement ?? "").trim().toLowerCase()
    if (!measurementStr) {
      skipped.push({ row: rowNum, reason: "measurement is required" })
      continue
    }
    const measurementId = measurementByKey.get(measurementStr)
    if (!measurementId) {
      skipped.push({
        row: rowNum,
        reason: `unknown measurement "${row.measurement}" — must match an existing measurement`,
      })
      continue
    }

    const packageSizeRaw = row.package_size
    let packageSize: number | null = null
    if (packageSizeRaw !== undefined && packageSizeRaw !== null && packageSizeRaw !== "") {
      const n = Number(packageSizeRaw)
      if (!isNaN(n) && n > 0) packageSize = n
    }

    // Optional product link by name
    const linkedProductName = String(row.linked_product_name ?? "").trim()
    let productId: string | null = null
    if (linkedProductName) {
      productId = productByName.get(linkedProductName.toLowerCase()) ?? null
      if (!productId) {
        warnings.push({
          row: rowNum,
          note: `product "${linkedProductName}" not found — linked as none`,
        })
      }
    }

    const { error } = await supabase
      .from("service_items")
      .insert({
        organisation_id: scope.organisationId,
        name,
        category,
        measurement_id:  measurementId,
        package_size:    packageSize,
        amount_cents:    Math.round(amountNaira * 100),
        product_id:      productId,
        is_active:       true,
        created_by:      authData.user.id,
      })

    if (error) {
      if (error.code === "23505") {
        skipped.push({ row: rowNum, reason: `service item "${name}" already exists` })
      } else {
        skipped.push({ row: rowNum, reason: "database error — contact support" })
        console.error("[importServiceItemsAction] row", rowNum, error)
      }
      continue
    }

    imported++
  }

  return { imported, skipped, warnings }
}

// ── Products (catalog-only) ───────────────────────────────────────────────────
// Writes ONLY to: products, branch_products.
// Zero writes to: product_stock, cost_layers, product_cost_state,
//                 cogs_allocations, stock_ledger, staff_holdings.

export async function importProductsAction(
  rows: Record<string, unknown>[],
): Promise<ImportResult> {
  const scope = await requireRole("owner", "inventory", "admin")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const { data: existingProducts } = await supabase
    .from("products")
    .select("sku, name")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)

  const existingSkus = new Set<string>(
    (existingProducts ?? []).filter((p: { sku: string }) => p.sku).map((p: { sku: string }) => p.sku.toLowerCase()),
  )

  const { data: branches } = await supabase
    .from("branches")
    .select("id")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)

  const branchIds: string[] = scope.branchId
    ? [scope.branchId]
    : (branches ?? []).map((b: { id: string }) => b.id)

  let imported = 0
  const skipped:  ImportResult["skipped"]  = []
  const warnings: ImportResult["warnings"] = []

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2
    const row    = rows[i]

    const name = String(row.name ?? "").trim()
    if (!name) {
      skipped.push({ row: rowNum, reason: "name is required" })
      continue
    }

    const sku = String(row.sku ?? "").trim()
    if (!sku) {
      skipped.push({ row: rowNum, reason: "sku is required — the product catalogue requires a unique SKU" })
      continue
    }

    if (existingSkus.has(sku.toLowerCase())) {
      skipped.push({ row: rowNum, reason: `product with SKU "${sku}" already exists` })
      continue
    }

    const unitCostNaira = Number(row.unit_cost_naira ?? 0)
    const unitCostCents = isNaN(unitCostNaira) || unitCostNaira < 0 ? null : Math.round(unitCostNaira * 100)

    const reorderRaw   = Number(row.reorder_point ?? 0)
    const reorderPoint = isNaN(reorderRaw) || reorderRaw < 0 ? 0 : Math.round(reorderRaw)

    const { data: inserted, error } = await supabase
      .from("products")
      .insert({
        organisation_id: scope.organisationId,
        sku,
        name,
        unit_cost_cents: unitCostCents,
        reorder_point:   reorderPoint,
      })
      .select("id")
      .single()

    if (error) {
      if (error.code === "23505") {
        skipped.push({ row: rowNum, reason: `product with SKU "${sku}" already exists` })
      } else {
        skipped.push({ row: rowNum, reason: "database error — contact support" })
        console.error("[importProductsAction] row", rowNum, error)
      }
      continue
    }

    if (branchIds.length > 0) {
      await supabase
        .from("branch_products")
        .upsert(
          branchIds.map((bid: string) => ({
            organisation_id: scope.organisationId,
            branch_id:       bid,
            product_id:      inserted.id,
          })),
          { onConflict: "branch_id,product_id", ignoreDuplicates: true },
        )
    }

    existingSkus.add(sku.toLowerCase())
    imported++
  }

  return { imported, skipped, warnings }
}

// ── Invoices (records-only) ───────────────────────────────────────────────────
// Uses record_vendor_invoice RPC (app_0029+) which does NOT write to:
// product_stock, stock_ledger, cost_layers, product_cost_state,
// cogs_allocations, staff_holdings.
// Imported invoices: receipt_status = 'pending', status = 'unpaid' (RPC defaults).
// Stock is only added by a separate receive_invoice_stock call — not done here.

function parseDateValue(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number") {
    return new Date((v - 25569) * 86400 * 1000).toISOString().split("T")[0]
  }
  return String(v).trim() || null
}

export async function importInvoicesAction(
  rows: Record<string, unknown>[],
): Promise<ImportResult> {
  const scope = await requireRole("owner", "inventory", "admin")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  // Vendors are branch-scoped — resolve by name within the org
  const { data: vendors } = await supabase
    .from("vendors")
    .select("id, name, branch_id")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)

  const vendorsByName = new Map<string, { id: string; branchId: string }[]>()
  for (const v of vendors ?? []) {
    const key = (v.name as string).toLowerCase()
    if (!vendorsByName.has(key)) vendorsByName.set(key, [])
    vendorsByName.get(key)!.push({ id: v.id as string, branchId: v.branch_id as string })
  }

  // Products are org-scoped — resolve by SKU first, then name
  const { data: products } = await supabase
    .from("products")
    .select("id, name, sku")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)

  const productByName = new Map<string, string>()
  const productBySku  = new Map<string, string>()
  for (const p of products ?? []) {
    productByName.set((p.name as string).toLowerCase(), p.id as string)
    if (p.sku) productBySku.set((p.sku as string).toLowerCase(), p.id as string)
  }

  // Group flat rows into invoice groups by (invoice_number | vendor + date)
  type InvoiceGroup = { startRow: number; rows: Record<string, unknown>[] }
  const groups = new Map<string, InvoiceGroup>()

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i]
    const rowNum = i + 2
    const invNum = String(row.invoice_number ?? "").trim()
    const vendor = String(row.vendor ?? "").trim().toLowerCase()
    const date   = String(row.invoice_date ?? "").trim()
    const key    = invNum
      ? `inv:${invNum.toLowerCase()}`
      : `nonum:${vendor}||${date}`

    if (!groups.has(key)) {
      groups.set(key, { startRow: rowNum, rows: [] })
    }
    groups.get(key)!.rows.push(row)
  }

  let imported = 0
  const skipped:  ImportResult["skipped"]  = []
  const warnings: ImportResult["warnings"] = []

  for (const [, group] of groups) {
    const { startRow, rows: invoiceRows } = group
    const firstRow = invoiceRows[0]

    const vendorName = String(firstRow.vendor ?? "").trim()
    if (!vendorName) {
      skipped.push({ row: startRow, reason: "vendor name is required" })
      continue
    }

    const vendorMatches = vendorsByName.get(vendorName.toLowerCase()) ?? []
    if (vendorMatches.length === 0) {
      skipped.push({ row: startRow, reason: `vendor "${vendorName}" not found in this org` })
      continue
    }
    if (vendorMatches.length > 1) {
      skipped.push({
        row:    startRow,
        reason: `vendor "${vendorName}" exists in multiple branches — ambiguous`,
      })
      continue
    }

    const { id: vendorId, branchId } = vendorMatches[0]

    const invoiceDate = parseDateValue(firstRow.invoice_date)
    if (!invoiceDate) {
      skipped.push({ row: startRow, reason: "invoice_date is required" })
      continue
    }

    // Resolve product IDs; skip the entire invoice if any line's product is unresolvable
    type ResolvedLine = { product_id: string; quantity: number; unit_cost_cents: number }
    const lines: ResolvedLine[] = []
    let lineError: string | null = null

    for (const lineRow of invoiceRows) {
      const skuKey  = String(lineRow.product_sku  ?? "").trim().toLowerCase()
      const nameKey = String(lineRow.product_name ?? "").trim().toLowerCase()
      const productId = skuKey  ? (productBySku.get(skuKey)   ?? null)
                      : nameKey ? (productByName.get(nameKey)  ?? null)
                      : null

      if (!productId) {
        const ref = String(lineRow.product_sku ?? lineRow.product_name ?? "").trim() || "(unnamed)"
        lineError = `product "${ref}" not found — create it first or run the product catalogue import`
        break
      }

      const qty = Number(lineRow.quantity ?? 0)
      if (!Number.isInteger(qty) || qty <= 0) {
        lineError = `invalid quantity "${lineRow.quantity}" — must be a positive integer`
        break
      }

      const unitCostNaira = Number(lineRow.unit_cost_naira ?? 0)
      if (isNaN(unitCostNaira) || unitCostNaira < 0) {
        lineError = `invalid unit_cost_naira "${lineRow.unit_cost_naira}" — must be non-negative`
        break
      }

      lines.push({
        product_id:      productId,
        quantity:        qty,
        unit_cost_cents: Math.round(unitCostNaira * 100),
      })
    }

    if (lineError) {
      skipped.push({ row: startRow, reason: lineError })
      continue
    }
    if (lines.length === 0) {
      skipped.push({ row: startRow, reason: "invoice has no valid lines" })
      continue
    }

    // record_vendor_invoice: creates vendor_invoices + vendor_invoice_lines.
    // Does NOT write product_stock, cost_layers, or any cost-engine table.
    const { error: rpcError } = await supabase.rpc("record_vendor_invoice", {
      p_branch_id:      branchId,
      p_vendor_id:      vendorId,
      p_invoice_number: String(firstRow.invoice_number ?? "").trim() || null,
      p_invoice_date:   invoiceDate,
      p_due_date:       parseDateValue(firstRow.due_date),
      p_note:           null,
      p_lines:          lines,
      p_vat_rate:       null,
    })

    if (rpcError) {
      const msg = (rpcError.message ?? "").toLowerCase()
      if (msg.includes("not authorised")) {
        skipped.push({ row: startRow, reason: "not authorised to create invoices in this branch" })
      } else {
        skipped.push({ row: startRow, reason: `database error: ${rpcError.message ?? "unknown"}` })
        console.error("[importInvoicesAction] row", startRow, rpcError)
      }
      continue
    }

    imported++
  }

  return { imported, skipped, warnings }
}
