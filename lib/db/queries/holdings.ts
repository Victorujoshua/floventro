import "server-only"
import { createAppServerClient, createAppServiceRoleClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export type HoldingMovementRow = {
  id: string
  createdAt: string
  quantityDelta: number
  balanceBefore: number
  balanceAfter: number
  movementLabel: string
  reason: string
  note: string | null
}

export type ProductHoldingHistory = {
  productId: string
  productName: string
  productSku: string
  movements: HoldingMovementRow[]  // newest-first for display
  finalBalance: number              // last balanceAfter — must equal staff_holdings.quantity
}

export type MyHolding = {
  productId: string
  productName: string
  productSku: string
  defaultPriceCents: number | null
  quantity: number
  branchId: string
  branchName: string
}

export type HolderGroup = {
  holderUserId: string
  holderName: string
  holderEmail: string
  items: {
    productId: string
    productName: string
    productSku: string
    quantity: number
  }[]
}

type RawHoldingRow = {
  branch_id: string
  product_id: string
  quantity: number
  branches: { name: string } | { name: string }[] | null
  products: { name: string; sku: string; default_price_cents: number | null } | { name: string; sku: string; default_price_cents: number | null }[] | null
}

type RawBranchHoldingRow = {
  branch_id: string
  holder_user_id: string
  product_id: string
  quantity: number
  products: { name: string; sku: string } | { name: string; sku: string }[] | null
}

function resolveBranch(raw: RawHoldingRow["branches"]): string {
  if (!raw) return ""
  if (Array.isArray(raw)) return raw[0]?.name ?? ""
  return raw.name
}

function resolveProduct(raw: RawHoldingRow["products"]): { name: string; sku: string; default_price_cents: number | null } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

function resolveProductBasic(raw: RawBranchHoldingRow["products"]): { name: string; sku: string } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

export async function getMyHoldings(): Promise<MyHolding[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()
  console.log("[getMyHoldings] before getUser")
  const { data: authData, error: userError } = await supabase.auth.getUser()
  console.log("[getMyHoldings] after getUser, user=", !!authData?.user)
  if (userError || !authData?.user) {
    console.error("[getMyHoldings] auth.getUser failed or no user", userError)
    return []
  }
  const user = authData.user

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("staff_holdings")
    .select("branch_id, product_id, quantity, branches(name), products(name, sku, default_price_cents)")
    .eq("holder_user_id", user.id)
    .eq("organisation_id", scope.organisationId)
    .gt("quantity", 0)
    .order("quantity", { ascending: false })

  if (error || !data) return []

  return (data as RawHoldingRow[]).map((row) => {
    const product = resolveProduct(row.products)
    return {
      productId: row.product_id,
      productName: product?.name ?? "Unknown product",
      productSku: product?.sku ?? "",
      defaultPriceCents: product?.default_price_cents ?? null,
      quantity: row.quantity,
      branchId: row.branch_id,
      branchName: resolveBranch(row.branches),
    }
  })
}

export async function getBranchHoldings(branchId: string | null): Promise<HolderGroup[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const query = supabase
    .from("staff_holdings")
    .select("branch_id, holder_user_id, product_id, quantity, products(name, sku)")
    .eq("organisation_id", scope.organisationId)
    .gt("quantity", 0)

  const { data, error } = branchId
    ? await query.eq("branch_id", branchId)
    : await query

  if (error || !data) return []

  const rows = data as RawBranchHoldingRow[]

  const holderIds = [...new Set(rows.map((r) => r.holder_user_id))]
  const admin = createAppServiceRoleClient()
  const nameMap = new Map<string, { name: string; email: string }>()
  await Promise.all(
    holderIds.map(async (uid) => {
      const { data: userData } = await admin.auth.admin.getUserById(uid)
      nameMap.set(uid, {
        name: (userData.user?.user_metadata?.full_name as string) ?? "",
        email: userData.user?.email ?? uid,
      })
    })
  )

  const groupMap = new Map<string, HolderGroup>()
  for (const row of rows) {
    const product = resolveProductBasic(row.products)
    if (!groupMap.has(row.holder_user_id)) {
      const info = nameMap.get(row.holder_user_id) ?? { name: "", email: row.holder_user_id }
      groupMap.set(row.holder_user_id, {
        holderUserId: row.holder_user_id,
        holderName: info.name,
        holderEmail: info.email,
        items: [],
      })
    }
    groupMap.get(row.holder_user_id)!.items.push({
      productId: row.product_id,
      productName: product?.name ?? "Unknown product",
      productSku: product?.sku ?? "",
      quantity: row.quantity,
    })
  }

  return [...groupMap.values()].sort((a, b) =>
    (a.holderName || a.holderEmail).localeCompare(b.holderName || b.holderEmail)
  )
}

// ── Per-product holding movement history (this user only) ────────────────────

export async function getMyHoldingHistory(): Promise<ProductHoldingHistory[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()
  const { data: authData } = await supabase.auth.getUser()
  if (!authData?.user) return []

  // Explicit holder_user_id filter is REQUIRED — RLS only gates by branch_id,
  // so without this filter a branch member would read all branch ledger rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("stock_ledger")
    .select("id, product_id, quantity_delta, reason, note, created_at, products(name, sku)")
    .eq("holder_user_id", authData.user.id)
    .eq("organisation_id", scope.organisationId)
    .order("product_id", { ascending: true })
    .order("created_at", { ascending: true })

  if (error || !data) return []

  type RawRow = {
    id: string
    product_id: string
    quantity_delta: number
    reason: string
    note: string | null
    created_at: string
    products: { name: string; sku: string } | { name: string; sku: string }[] | null
  }

  function resolveProductInfo(raw: RawRow["products"]) {
    if (!raw) return null
    return Array.isArray(raw) ? (raw[0] ?? null) : raw
  }

  function toMovementLabel(reason: string): string {
    switch (reason) {
      case "issue_to_holding": return "Issued to holding"
      case "sale":             return "Sold from holding"
      case "usage":            return "Used in service"
      case "return_to_branch": return "Returned to branch"
      default:                 return reason
    }
  }

  // Group by product_id, accumulate running balance oldest-first.
  // All rows carry holder_user_id = user.id (enforced by the query filter above +
  // the stock_ledger_holder_consistency CHECK constraint), so the balance
  // accumulation is unconditional — no branch/holder split needed.
  const productMap = new Map<string, {
    productName: string
    productSku: string
    rows: HoldingMovementRow[]
    balance: number
  }>()

  for (const row of data as RawRow[]) {
    const p = resolveProductInfo(row.products)
    if (!productMap.has(row.product_id)) {
      productMap.set(row.product_id, {
        productName: p?.name ?? "Unknown product",
        productSku: p?.sku ?? "",
        rows: [],
        balance: 0,
      })
    }
    const entry = productMap.get(row.product_id)!
    const balanceBefore = entry.balance
    entry.balance += row.quantity_delta
    entry.rows.push({
      id: row.id,
      createdAt: row.created_at,
      quantityDelta: row.quantity_delta,
      balanceBefore,
      balanceAfter: entry.balance,
      movementLabel: toMovementLabel(row.reason),
      reason: row.reason,
      note: row.note,
    })
  }

  return [...productMap.entries()].map(([productId, entry]) => ({
    productId,
    productName: entry.productName,
    productSku: entry.productSku,
    movements: [...entry.rows].reverse(),  // newest first for display
    finalBalance: entry.balance,           // invariant: must equal staff_holdings.quantity
  }))
}
