"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import { adjustmentSchema, type AdjustmentInput } from "@/lib/validation/adjustments"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function adjustStockAction(
  input: AdjustmentInput,
): Promise<ActionResult<{ newQuantity: number }>> {
  const parsed = adjustmentSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  // Resolve branch (mirrors the invoice + request action pattern).
  let branchId: string
  if (scope.branchId) {
    branchId = scope.branchId
  } else if (parsed.data.branchId) {
    branchId = parsed.data.branchId
  } else {
    const { data: branches } = await supabase
      .from("branches")
      .select("id")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)

    if (!branches || branches.length === 0) {
      return { ok: false, error: "No branches found in this organisation" }
    }
    if (branches.length > 1) {
      return { ok: false, error: "Select a branch", message: "branch_required" }
    }
    branchId = branches[0].id
  }

  const { data, error } = await supabase.rpc("adjust_stock", {
    p_branch_id:         branchId,
    p_product_id:        parsed.data.productId,
    p_new_quantity:      parsed.data.mode === "set" ? (parsed.data.newQuantity ?? null) : null,
    p_delta:             parsed.data.mode === "adjust" ? (parsed.data.delta ?? null) : null,
    p_adjustment_reason: parsed.data.adjustmentReason,
    p_note:              parsed.data.note ?? "",
  })

  if (error) {
    const msg = error.message
    const lower = msg.toLowerCase()

    if (lower.includes("opening stock can only be set")) {
      return { ok: false, error: "opening_stock_not_allowed", message: msg }
    }
    if (lower.includes("a note is required")) {
      return { ok: false, error: "note_required", message: "A note is required for this adjustment." }
    }
    if (lower.includes("would make stock negative") || lower.includes("adjustment would make stock")) {
      return { ok: false, error: "would_go_negative", message: msg }
    }
    if (lower.includes("not authorised")) {
      return { ok: false, error: "not_allowed", message: "You are not authorised to adjust stock in this branch." }
    }
    if (lower.includes("no change")) {
      return { ok: false, error: "no_change", message: msg }
    }
    return { ok: false, error: "server", message: msg }
  }

  return { ok: true, data: { newQuantity: data as number } }
}
