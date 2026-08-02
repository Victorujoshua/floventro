// Diagnostic: measure cost_layers gap vs product_stock + staff_holdings (all products/buckets)
// Fetches all active layers + stock positions in bulk and compares in JS.
// No SQL, no RPC changes required — read-only service role queries.
// Run: node scripts/diagnose-fifo-gap.mjs

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"
import { resolve } from "path"

const envPath = resolve(process.cwd(), ".env.local")
const envRaw = readFileSync(envPath, "utf8")
const env = Object.fromEntries(
  envRaw.split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const supabase = createClient(
  env.NEXT_PUBLIC_APP_SUPABASE_URL,
  env.APP_SUPABASE_SERVICE_ROLE_KEY
)

// ── 1. Fetch all product_stock with quantity > 0 ──────────────────────────────
const { data: poolStock, error: e1 } = await supabase
  .from("product_stock")
  .select("branch_id, product_id, quantity")
  .gt("quantity", 0)

if (e1) { console.error("product_stock error", e1); process.exit(1) }

// ── 2. Fetch all staff_holdings with quantity > 0 ─────────────────────────────
const { data: holderStock, error: e2 } = await supabase
  .from("staff_holdings")
  .select("branch_id, holder_user_id, product_id, quantity")
  .gt("quantity", 0)

if (e2) { console.error("staff_holdings error", e2); process.exit(1) }

// ── 3. Fetch all active cost_layers (pool: holder_user_id IS NULL) ────────────
const { data: poolLayers, error: e3 } = await supabase
  .from("cost_layers")
  .select("branch_id, product_id, qty_remaining")
  .is("holder_user_id", null)
  .gt("qty_remaining", 0)

if (e3) { console.error("cost_layers (pool) error", e3); process.exit(1) }

// ── 4. Fetch all active cost_layers (holder: holder_user_id IS NOT NULL) ──────
const { data: holderLayers, error: e4 } = await supabase
  .from("cost_layers")
  .select("branch_id, holder_user_id, product_id, qty_remaining")
  .not("holder_user_id", "is", null)
  .gt("qty_remaining", 0)

if (e4) { console.error("cost_layers (holder) error", e4); process.exit(1) }

// ── 5. Fetch product_cost_state for all buckets (need avg_cost for backfill) ──
const { data: costState, error: e5 } = await supabase
  .from("product_cost_state")
  .select("branch_id, holder_user_id, product_id, quantity, avg_cost_cents, total_cost_cents")

if (e5) { console.error("product_cost_state error", e5); process.exit(1) }

// ── 6. Fetch product names ────────────────────────────────────────────────────
const { data: products, error: e6 } = await supabase
  .from("products")
  .select("id, name, sku")

if (e6) { console.error("products error", e6); process.exit(1) }

// ── 7. Fetch branch names ─────────────────────────────────────────────────────
const { data: branches, error: e7 } = await supabase
  .from("branches")
  .select("id, name")

if (e7) { console.error("branches error", e7); process.exit(1) }

// ── Build lookup maps ─────────────────────────────────────────────────────────
const productName = new Map(products.map(p => [p.id, `${p.name} (${p.sku})`]))
const branchName  = new Map(branches.map(b => [b.id, b.name]))

function pkey(branch, product)         { return `${branch}|${product}` }
function hkey(branch, holder, product) { return `${branch}|${holder}|${product}` }

// Pool layer sums: key = branch_id|product_id
const poolLayerSum = new Map()
for (const r of poolLayers) {
  const k = pkey(r.branch_id, r.product_id)
  poolLayerSum.set(k, (poolLayerSum.get(k) ?? 0) + r.qty_remaining)
}

// Holder layer sums: key = branch_id|holder_user_id|product_id
const holderLayerSum = new Map()
for (const r of holderLayers) {
  const k = hkey(r.branch_id, r.holder_user_id, r.product_id)
  holderLayerSum.set(k, (holderLayerSum.get(k) ?? 0) + r.qty_remaining)
}

// product_cost_state lookup: pool = pkey, holder = hkey
const poolCostState   = new Map()
const holderCostState = new Map()
for (const r of costState) {
  if (r.holder_user_id == null) {
    poolCostState.set(pkey(r.branch_id, r.product_id), r)
  } else {
    holderCostState.set(hkey(r.branch_id, r.holder_user_id, r.product_id), r)
  }
}

// ── Detect gaps ───────────────────────────────────────────────────────────────
const poolGaps   = []
const holderGaps = []

for (const r of poolStock) {
  const k       = pkey(r.branch_id, r.product_id)
  const layerQty = poolLayerSum.get(k) ?? 0
  if (r.quantity !== layerQty) {
    const pcs = poolCostState.get(k)
    poolGaps.push({
      branch:       branchName.get(r.branch_id) ?? r.branch_id,
      product:      productName.get(r.product_id) ?? r.product_id,
      branch_id:    r.branch_id,
      product_id:   r.product_id,
      stock_qty:    r.quantity,
      layer_qty:    layerQty,
      gap:          r.quantity - layerQty,
      avg_cost_cents:   pcs?.avg_cost_cents   ?? null,
      total_cost_cents: pcs?.total_cost_cents ?? null,
      pcs_qty:          pcs?.quantity         ?? null,
    })
  }
}

for (const r of holderStock) {
  const k       = hkey(r.branch_id, r.holder_user_id, r.product_id)
  const layerQty = holderLayerSum.get(k) ?? 0
  if (r.quantity !== layerQty) {
    const pcs = holderCostState.get(k)
    holderGaps.push({
      branch:       branchName.get(r.branch_id) ?? r.branch_id,
      product:      productName.get(r.product_id) ?? r.product_id,
      branch_id:    r.branch_id,
      holder_user_id: r.holder_user_id,
      product_id:   r.product_id,
      stock_qty:    r.quantity,
      layer_qty:    layerQty,
      gap:          r.quantity - layerQty,
      avg_cost_cents:   pcs?.avg_cost_cents   ?? null,
      total_cost_cents: pcs?.total_cost_cents ?? null,
      pcs_qty:          pcs?.quantity         ?? null,
    })
  }
}

const fmt = n => n == null ? "NULL" : `${(n).toLocaleString()} (₦${(n/100).toFixed(2)})`

// ── Report ────────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════════")
console.log("  FIFO GAP REPORT — cost_layers vs product_stock / staff_holdings")
console.log("══════════════════════════════════════════════════════════════════\n")

if (poolGaps.length === 0) {
  console.log("✓ POOL BUCKETS: no gaps found\n")
} else {
  console.log(`✗ POOL BUCKETS: ${poolGaps.length} gap(s)\n`)
  for (const g of poolGaps) {
    console.log(`  Branch:    ${g.branch}`)
    console.log(`  Product:   ${g.product}`)
    console.log(`  branch_id: ${g.branch_id}`)
    console.log(`  product_id:${g.product_id}`)
    console.log(`  stock_qty: ${g.stock_qty}  layer_qty: ${g.layer_qty}  GAP: ${g.gap}`)
    console.log(`  pcs_qty:   ${g.pcs_qty ?? "NULL (no product_cost_state row)"}`)
    console.log(`  avg_cost:  ${fmt(g.avg_cost_cents)}`)
    console.log(`  total_cost:${fmt(g.total_cost_cents)}`)
    console.log()
  }
}

if (holderGaps.length === 0) {
  console.log("✓ HOLDER BUCKETS: no gaps found\n")
} else {
  console.log(`✗ HOLDER BUCKETS: ${holderGaps.length} gap(s)\n`)
  for (const g of holderGaps) {
    console.log(`  Branch:         ${g.branch}`)
    console.log(`  Product:        ${g.product}`)
    console.log(`  branch_id:      ${g.branch_id}`)
    console.log(`  holder_user_id: ${g.holder_user_id}`)
    console.log(`  product_id:     ${g.product_id}`)
    console.log(`  stock_qty:      ${g.stock_qty}  layer_qty: ${g.layer_qty}  GAP: ${g.gap}`)
    console.log(`  pcs_qty:        ${g.pcs_qty ?? "NULL (no product_cost_state row)"}`)
    console.log(`  avg_cost:       ${fmt(g.avg_cost_cents)}`)
    console.log(`  total_cost:     ${fmt(g.total_cost_cents)}`)
    console.log()
  }
}

console.log("══════════════════════════════════════════════════════════════════")
console.log(`  Summary: ${poolGaps.length} pool gap(s), ${holderGaps.length} holder gap(s)`)
console.log("══════════════════════════════════════════════════════════════════\n")
