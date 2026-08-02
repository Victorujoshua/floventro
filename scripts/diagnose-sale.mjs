// Diagnostic: check cost_layers vs staff_holdings for the failing sale
// Product: Pskyn Liquer (PSKN-01) bdea271e-02fa-4cb5-af13-488d94b818b4
// Run: node scripts/diagnose-sale.mjs

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"
import { resolve } from "path"

// Read env from .env.local
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

const PRODUCT_ID = "bdea271e-02fa-4cb5-af13-488d94b818b4"

console.log("\n=== 1. Organisations: costing_method ===")
const { data: orgs, error: e1 } = await supabase
  .from("organisations")
  .select("id, name, costing_method")
console.log(e1 ?? JSON.stringify(orgs, null, 2))

console.log("\n=== 2. Branches named HeadQuarters ===")
const { data: branches, error: e2 } = await supabase
  .from("branches")
  .select("id, name, organisation_id")
  .ilike("name", "%HeadQuart%")
console.log(e2 ?? JSON.stringify(branches, null, 2))

console.log("\n=== 3. staff_holdings for this product (all holders) ===")
const { data: holdings, error: e3 } = await supabase
  .from("staff_holdings")
  .select("branch_id, holder_user_id, product_id, quantity")
  .eq("product_id", PRODUCT_ID)
console.log(e3 ?? JSON.stringify(holdings, null, 2))

console.log("\n=== 4. cost_layers for this product — holder buckets (non-pool) ===")
const { data: layers, error: e4 } = await supabase
  .from("cost_layers")
  .select("id, branch_id, holder_user_id, product_id, original_seq, qty_remaining, unit_cost_cents, source_ref_type")
  .eq("product_id", PRODUCT_ID)
  .not("holder_user_id", "is", null)
  .gt("qty_remaining", 0)
  .order("original_seq", { ascending: true })
console.log(e4 ?? JSON.stringify(layers, null, 2))

console.log("\n=== 5. cost_layers total qty_remaining per holder for this product ===")
const { data: layersTotals, error: e5 } = await supabase
  .from("cost_layers")
  .select("holder_user_id, qty_remaining")
  .eq("product_id", PRODUCT_ID)
  .not("holder_user_id", "is", null)
console.log(e5 ?? "")
if (layersTotals) {
  const totals = {}
  for (const r of layersTotals) {
    totals[r.holder_user_id] = (totals[r.holder_user_id] ?? 0) + (r.qty_remaining ?? 0)
  }
  console.log("Summed by holder_user_id:", JSON.stringify(totals, null, 2))
}

console.log("\n=== 6. product_cost_state for this product — holder buckets ===")
const { data: costState, error: e6 } = await supabase
  .from("product_cost_state")
  .select("branch_id, holder_user_id, product_id, quantity, avg_cost_cents, total_cost_cents")
  .eq("product_id", PRODUCT_ID)
  .not("holder_user_id", "is", null)
console.log(e6 ?? JSON.stringify(costState, null, 2))

console.log("\nDone.")
