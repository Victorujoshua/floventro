"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireScope } from "@/lib/auth/guards"
import { returnSchema } from "@/lib/validation/returns"
import type { ReturnInput } from "@/lib/validation/returns"

type ActionResult = { ok: true } | { ok: false; error: string; message?: string }

export async function returnToBranchAction(input: ReturnInput): Promise<ActionResult> {
  const parsed = returnSchema.safeParse(input)
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
      return { ok: false, error: "branch_required", message: "Select a branch before returning stock." }
    }
    branchId = branches[0].id
  }

  const { productId, quantity, note } = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("return_to_branch", {
    p_branch_id: branchId,
    p_product_id: productId,
    p_quantity: quantity,
    p_note: note || null,
  })

  if (error) {
    const msg: string = error.message ?? ""
    const lower = msg.toLowerCase()

    if (lower.includes("insufficient holding")) {
      const productMatch = msg.match(/insufficient holding for product ([0-9a-f-]{36})/i)
      const numbersMatch = msg.match(/\(holding: (\d+), returning: (\d+)\)/i)

      if (productMatch) {
        const pid = productMatch[1]
        const { data: product } = await supabase
          .from("products")
          .select("name, sku")
          .eq("id", pid)
          .single()

        if (product) {
          const held = numbersMatch ? parseInt(numbersMatch[1], 10) : 0
          const returning = numbersMatch ? parseInt(numbersMatch[2], 10) : 0
          return {
            ok: false,
            error: "insufficient_holding",
            message: `You don't have enough ${product.name} (${product.sku}) to return — holding ${held}, returning ${returning}.`,
          }
        }
      }
      return {
        ok: false,
        error: "insufficient_holding",
        message: "You don't have enough stock in your holding to return.",
      }
    }

    if (lower.includes("not authorised"))
      return { ok: false, error: "not_allowed", message: "You are not authorised to return stock in this branch." }
    if (lower.includes("product not found"))
      return { ok: false, error: "invalid_product", message: "Product not found in this organisation." }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true }
}
