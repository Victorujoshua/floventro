"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import { initiateTransferSchema, receiveTransferSchema } from "@/lib/validation/transfers"
import type { InitiateTransferInput, ReceiveTransferInput } from "@/lib/validation/transfers"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function initiateTransferAction(
  input: InitiateTransferInput,
): Promise<ActionResult<{ transferId: string }>> {
  const parsed = initiateTransferSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const { sourceBranchId, destBranchId, note, lines } = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("initiate_transfer", {
    p_source_branch_id: sourceBranchId,
    p_dest_branch_id: destBranchId,
    p_note: note || null,
    p_lines: lines.map((l) => ({ product_id: l.productId, quantity: l.quantity })),
  })

  if (error) {
    const msg: string = error.message ?? ""
    const lower = msg.toLowerCase()

    if (lower.includes("insufficient stock")) {
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
          return {
            ok: false,
            error: "insufficient_stock",
            message: `Not enough ${product.name} (${product.sku}) — ${onHand} on hand, trying to send ${sending}.`,
          }
        }
      }
      return { ok: false, error: "insufficient_stock", message: "Insufficient stock at the source branch." }
    }

    if (lower.includes("source and destination must differ"))
      return { ok: false, error: "same_branch", message: "Source and destination must be different branches." }
    if (lower.includes("source branch not found"))
      return { ok: false, error: "invalid_branch", message: "Source branch not found." }
    if (lower.includes("destination branch not found"))
      return { ok: false, error: "invalid_branch", message: "Destination branch not found." }
    if (lower.includes("cannot transfer between different organisations"))
      return { ok: false, error: "invalid_branch", message: "Cannot transfer between different organisations." }
    if (lower.includes("not authorised to send"))
      return { ok: false, error: "not_allowed", message: "You are not authorised to send stock from this branch." }
    if (lower.includes("product") && lower.includes("not found"))
      return { ok: false, error: "invalid_product", message: "One or more products not found in this organisation." }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { transferId: data as string } }
}

export async function receiveTransferAction(
  input: ReceiveTransferInput,
): Promise<ActionResult> {
  const parsed = receiveTransferSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const { transferId, lines, note } = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("receive_transfer", {
    p_transfer_id: transferId,
    p_lines: lines.map((l) => ({ line_id: l.lineId, quantity_received: l.quantityReceived })),
    p_note: note || null,
  })

  if (error) {
    const msg: string = error.message ?? ""
    const lower = msg.toLowerCase()

    if (lower.includes("transfer not found"))
      return { ok: false, error: "not_found", message: "Transfer not found." }
    if (lower.includes("not in transit"))
      return { ok: false, error: "wrong_status", message: "This transfer has already been received or cancelled." }
    if (lower.includes("not authorised to receive"))
      return { ok: false, error: "not_allowed", message: "You are not authorised to receive stock at the destination branch." }
    if (lower.includes("cannot receive more than sent"))
      return { ok: false, error: "over_receive", message: "Cannot receive more than was sent for one or more lines." }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: null }
}

export async function cancelTransferAction(
  transferId: string,
  note?: string,
): Promise<ActionResult> {
  if (!transferId) return { ok: false, error: "invalid", message: "Transfer ID required." }

  await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("cancel_transfer", {
    p_transfer_id: transferId,
    p_note: note || null,
  })

  if (error) {
    const msg: string = error.message ?? ""
    const lower = msg.toLowerCase()

    if (lower.includes("transfer not found"))
      return { ok: false, error: "not_found", message: "Transfer not found." }
    if (lower.includes("only in-transit transfers can be cancelled"))
      return { ok: false, error: "wrong_status", message: "Only in-transit transfers can be cancelled." }
    if (lower.includes("not authorised to cancel"))
      return { ok: false, error: "not_allowed", message: "You are not authorised to cancel this transfer." }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: null }
}
