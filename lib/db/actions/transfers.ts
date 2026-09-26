"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import { receiveTransferSchema } from "@/lib/validation/transfers"
import type { ReceiveTransferInput } from "@/lib/validation/transfers"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function receiveTransferAction(
  input: ReceiveTransferInput,
): Promise<ActionResult> {
  const parsed = receiveTransferSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  await requireRole("owner", "inventory", "admin")
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

  await requireRole("owner", "inventory", "admin")
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
