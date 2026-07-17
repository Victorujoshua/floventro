"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import { paymentSchema, type PaymentInput } from "@/lib/validation/payments"
import { formatNaira } from "@/lib/format/money"
import { getInvoicePayments } from "@/lib/db/queries/payments"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function recordPaymentAction(
  input: PaymentInput,
): Promise<ActionResult<{ status: string }>> {
  const parsed = paymentSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  await requireRole("owner", "inventory")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const amountCents = Math.round(parsed.data.amountNaira * 100)

  const { data, error } = await supabase.rpc("record_vendor_payment", {
    p_invoice_id:   parsed.data.invoiceId,
    p_amount_cents: amountCents,
    p_paid_on:      parsed.data.paidOn,
    p_method:       parsed.data.method,
    p_reference:    parsed.data.reference || null,
    p_note:         parsed.data.note || null,
  })

  if (error) {
    const msg   = error.message as string
    const lower = msg.toLowerCase()

    if (lower.includes("already fully paid")) {
      return { ok: false, error: "already_paid", message: "This invoice is already fully paid." }
    }

    if (lower.includes("payment exceeds the outstanding balance")) {
      const match = msg.match(/outstanding: (\d+), attempted: (\d+)/)
      if (match) {
        const outstanding = parseInt(match[1], 10)
        return {
          ok: false,
          error: "over_payment",
          message: `Payment exceeds the outstanding balance. Outstanding: ₦${formatNaira(outstanding)}.`,
        }
      }
      return { ok: false, error: "over_payment", message: "Payment exceeds the outstanding balance." }
    }

    if (lower.includes("not authorised")) {
      return { ok: false, error: "not_allowed", message: "You are not authorised to record payments in this branch." }
    }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { status: data as string } }
}

export async function getInvoicePaymentsAction(invoiceId: string) {
  await requireRole("owner", "inventory")
  return getInvoicePayments(invoiceId)
}
