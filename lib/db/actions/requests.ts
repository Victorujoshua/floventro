"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireScope, requireRole } from "@/lib/auth/guards"
import { requestSchema, type RequestInput } from "@/lib/validation/requests"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function createRequestAction(
  input: RequestInput,
): Promise<ActionResult<{ requestId: string }>> {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireScope()
  const supabase = await createAppServerClient()

  // Resolve branch the same way as invoices.
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

  const { data: header, error: headerErr } = await supabase
    .from("stock_requests")
    .insert({
      organisation_id: scope.organisationId,
      branch_id: branchId,
      requested_by: scope.userId,
      purpose: parsed.data.purpose || null,
    })
    .select("id")
    .single()

  if (headerErr || !header) {
    return { ok: false, error: "Failed to create request" }
  }

  const { error: linesErr } = await supabase.from("stock_request_lines").insert(
    parsed.data.lines.map((l) => ({
      request_id: header.id,
      product_id: l.productId,
      quantity_requested: l.quantity,
    })),
  )

  if (linesErr) {
    return { ok: false, error: "Failed to add request lines" }
  }

  return { ok: true, data: { requestId: header.id } }
}

export async function cancelRequestAction(id: string): Promise<ActionResult> {
  const scope = await requireScope()
  const supabase = await createAppServerClient()

  const { error } = await supabase
    .from("stock_requests")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("requested_by", scope.userId)
    .eq("status", "pending")

  if (error) {
    return { ok: false, error: "Failed to cancel request" }
  }
  return { ok: true, data: null }
}

export async function reviewRequestAction(
  requestId: string,
  decision: "approve" | "reject",
  lines: { lineId: string; quantityApproved: number }[],
  note: string,
): Promise<ActionResult<{ status: string }>> {
  await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const { data, error } = await supabase.rpc("review_stock_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_lines: lines.map((l) => ({
      line_id: l.lineId,
      quantity_approved: l.quantityApproved,
    })),
    p_review_note: note || null,
  })

  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes("insufficient stock")) {
      return { ok: false, error: "insufficient_stock", message: error.message }
    }
    if (msg.includes("not authorised")) return { ok: false, error: "not_allowed" }
    if (msg.includes("already reviewed")) return { ok: false, error: "already_reviewed" }
    return { ok: false, error: "server", message: error.message }
  }

  return { ok: true, data: { status: data as string } }
}
