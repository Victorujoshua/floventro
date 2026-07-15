"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireScope } from "@/lib/auth/guards"
import { saleSchema, type SaleInput } from "@/lib/validation/sales"
import { getSaleById, type SaleDetail } from "@/lib/db/queries/sales"

export type { SaleDetail }

export async function getSaleDetailAction(id: string): Promise<SaleDetail | null> {
  await requireScope()
  return getSaleById(id)
}

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function recordSaleAction(input: SaleInput): Promise<ActionResult<{ saleId: string }>> {
  const parsed = saleSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireScope()
  const supabase = await createAppServerClient()

  let branchId = scope.branchId ?? ""
  if (!branchId) {
    const { data: branches } = await supabase
      .from("branches")
      .select("id")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)
    if (!branches || branches.length === 0) {
      return { ok: false, error: "server", message: "No branches found in this organisation." }
    }
    if (branches.length > 1) {
      return { ok: false, error: "branch_required", message: "Select a branch before recording a sale." }
    }
    branchId = branches[0].id
  }

  const pLines = parsed.data.lines.map((l) => ({
    product_id: l.productId,
    quantity: l.quantity,
    unit_price_cents: Math.round(l.unitPriceNaira * 100),
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("record_sale", {
    p_branch_id: branchId,
    p_customer_name: parsed.data.customerName || null,
    p_customer_phone: parsed.data.customerPhone || null,
    p_sold_on: parsed.data.soldOn,
    p_note: parsed.data.note || null,
    p_lines: pLines,
  })

  if (error) {
    const msg: string = error.message ?? ""
    const lower = msg.toLowerCase()

    if (lower.includes("insufficient holding")) {
      const productMatch = msg.match(/insufficient holding for product ([0-9a-f-]{36})/i)
      const numbersMatch = msg.match(/\(holding: (\d+), selling: (\d+)\)/i)

      if (productMatch) {
        const productId = productMatch[1]
        const { data: product } = await supabase
          .from("products")
          .select("name, sku")
          .eq("id", productId)
          .single()

        if (product) {
          const held = numbersMatch ? parseInt(numbersMatch[1], 10) : 0
          const selling = numbersMatch ? parseInt(numbersMatch[2], 10) : 0
          const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n)
          return {
            ok: false,
            error: "insufficient_holding",
            message: `You don't hold enough ${product.name} (${product.sku}) — holding ${fmt(held)}, selling ${fmt(selling)}.`,
          }
        }
      }
      return {
        ok: false,
        error: "insufficient_holding",
        message: "You don't have enough stock in your holding to complete this sale.",
      }
    }

    if (lower.includes("not authorised"))
      return { ok: false, error: "not_allowed", message: "You are not authorised to record sales in this branch." }
    if (lower.includes("at least one line"))
      return { ok: false, error: "validation", message: "Add at least one product to the sale." }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { saleId: data as string } }
}
