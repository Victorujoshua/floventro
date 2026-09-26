"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import {
  createTransferRequestSchema,
  approveTransferRequestSchema,
} from "@/lib/validation/transfer-requests"
import type {
  CreateTransferRequestInput,
  ApproveTransferRequestInput,
} from "@/lib/validation/transfer-requests"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

// transfer_requests RPCs are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

// Errors shared by every request RPC.
function commonError(lower: string): ActionResult<never> | null {
  if (lower.includes("request not found"))
    return { ok: false, error: "not_found", message: "Request not found." }
  if (lower.includes("already reviewed"))
    return { ok: false, error: "wrong_status", message: "This request has already been reviewed." }
  if (lower.includes("not authorised"))
    return { ok: false, error: "not_allowed", message: "You don't have permission to do this for this branch." }
  return null
}

// "insufficient stock for product <uuid> at source branch (on hand: n, sending: m)"
async function insufficientStockMessage(supabase: AnyClient, msg: string): Promise<string> {
  const productMatch = msg.match(/for product ([0-9a-f-]{36})/i)
  const numbersMatch = msg.match(/\(on hand: (\d+), sending: (\d+)\)/i)
  if (productMatch) {
    const { data: product } = await supabase
      .from("products")
      .select("name, sku")
      .eq("id", productMatch[1])
      .single()
    if (product) {
      const onHand = numbersMatch ? parseInt(numbersMatch[1], 10) : 0
      const sending = numbersMatch ? parseInt(numbersMatch[2], 10) : 0
      return `Not enough ${product.name} (${product.sku}) — ${onHand} on hand, approving ${sending}. Lower the approved quantity.`
    }
  }
  return "Not enough stock at this branch for the approved quantities."
}

export async function createTransferRequestAction(
  input: CreateTransferRequestInput,
): Promise<ActionResult<{ requestId: string }>> {
  const parsed = createTransferRequestSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory", "admin")

  // The requesting (destination) branch is always the branch the caller is inside.
  if (!scope.branchId) {
    return { ok: false, error: "no_branch", message: "Enter a branch before requesting stock." }
  }

  const supabase: AnyClient = await createAppServerClient()
  const { sourceBranchId, note, lines } = parsed.data

  const { data, error } = await supabase.rpc("create_transfer_request", {
    p_source_branch_id: sourceBranchId,
    p_dest_branch_id: scope.branchId,
    p_note: note || null,
    p_lines: lines.map((l) => ({ product_id: l.productId, quantity: l.quantity })),
  })

  if (error) {
    const lower = (error.message ?? "").toLowerCase()
    if (lower.includes("source and destination must differ"))
      return { ok: false, error: "same_branch", message: "You can't request stock from your own branch." }
    if (lower.includes("listed more than once"))
      return { ok: false, error: "duplicate_product", message: "Each product can only be listed once." }
    if (lower.includes("product") && lower.includes("not found"))
      return { ok: false, error: "invalid_product", message: "One or more products not found in this organisation." }
    if (lower.includes("branch not found"))
      return { ok: false, error: "invalid_branch", message: "Branch not found." }
    return commonError(lower) ?? { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { requestId: data as string } }
}

export async function approveTransferRequestAction(
  input: ApproveTransferRequestInput,
): Promise<ActionResult<{ status: string }>> {
  const parsed = approveTransferRequestSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  await requireRole("owner", "inventory", "admin")
  const supabase: AnyClient = await createAppServerClient()
  const { requestId, lines, note } = parsed.data

  const { data, error } = await supabase.rpc("approve_transfer_request", {
    p_request_id: requestId,
    p_lines: lines.map((l) => ({ line_id: l.lineId, quantity_approved: l.quantityApproved })),
    p_review_note: note || null,
  })

  if (error) {
    const msg: string = error.message ?? ""
    const lower = msg.toLowerCase()
    if (lower.includes("insufficient stock"))
      return { ok: false, error: "insufficient_stock", message: await insufficientStockMessage(supabase, msg) }
    if (lower.includes("cannot approve more than requested"))
      return { ok: false, error: "over_approve", message: "Can't approve more than was requested." }
    return commonError(lower) ?? { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { status: data as string } }
}

export async function rejectTransferRequestAction(
  requestId: string,
  note: string,
): Promise<ActionResult> {
  if (!requestId) return { ok: false, error: "invalid", message: "Request ID required." }

  await requireRole("owner", "inventory", "admin")
  const supabase: AnyClient = await createAppServerClient()

  const { error } = await supabase.rpc("reject_transfer_request", {
    p_request_id: requestId,
    p_review_note: note || null,
  })

  if (error) {
    const lower = (error.message ?? "").toLowerCase()
    return commonError(lower) ?? { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: null }
}

export async function cancelTransferRequestAction(requestId: string): Promise<ActionResult> {
  if (!requestId) return { ok: false, error: "invalid", message: "Request ID required." }

  await requireRole("owner", "inventory", "admin")
  const supabase: AnyClient = await createAppServerClient()

  const { error } = await supabase.rpc("cancel_transfer_request", { p_request_id: requestId })

  if (error) {
    const lower = (error.message ?? "").toLowerCase()
    if (lower.includes("only the requester"))
      return { ok: false, error: "not_allowed", message: "Only the person who made the request can cancel it." }
    if (lower.includes("only pending"))
      return { ok: false, error: "wrong_status", message: "This request has already been reviewed." }
    return commonError(lower) ?? { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: null }
}

// Stock on hand at another branch, for the request form ("Main has 340").
export async function getBranchAvailableStockAction(
  branchId: string,
): Promise<ActionResult<Record<string, number>>> {
  if (!branchId) return { ok: false, error: "invalid", message: "Branch required." }

  await requireRole("owner", "inventory", "admin")
  const supabase: AnyClient = await createAppServerClient()

  const { data, error } = await supabase.rpc("get_branch_available_stock", { p_branch_id: branchId })
  if (error) {
    return { ok: false, error: "server", message: "Couldn't load that branch's stock." }
  }

  const stock: Record<string, number> = {}
  for (const row of (data ?? []) as { product_id: string; quantity: number }[]) {
    stock[row.product_id] = row.quantity
  }
  return { ok: true, data: stock }
}
