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
    const msg = error.message
    const lower = msg.toLowerCase()

    if (lower.includes("insufficient stock")) {
      const productMatch = msg.match(/insufficient stock for product ([0-9a-f-]{36})/i)
      const numbersMatch = msg.match(/\(on hand: (\d+), requested: (\d+)\)/i)

      if (productMatch && numbersMatch) {
        const productId = productMatch[1]
        const onHand = parseInt(numbersMatch[1], 10)
        const requested = parseInt(numbersMatch[2], 10)
        const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n)

        const { data: product } = await supabase
          .from("products")
          .select("name, sku")
          .eq("id", productId)
          .single()

        if (product) {
          return {
            ok: false,
            error: "insufficient_stock",
            message: `Not enough ${product.name} (${product.sku}) in stock — ${fmt(onHand)} on hand, ${fmt(requested)} requested.`,
          }
        }
      }

      return { ok: false, error: "insufficient_stock", message: "Not enough stock to fulfil this request." }
    }

    if (lower.includes("not authorised")) return { ok: false, error: "not_allowed" }
    if (lower.includes("already reviewed")) return { ok: false, error: "already_reviewed" }
    if (lower.includes("is not part of this request"))
      return { ok: false, error: "server", message: "One or more lines are not part of this request." }
    if (lower.includes("approved quantity for line"))
      return { ok: false, error: "server", message: "Invalid approved quantity on one or more lines." }
    if (lower.includes("cannot approve more than requested for line"))
      return { ok: false, error: "server", message: "Cannot approve more than the requested quantity." }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { status: data as string } }
}
