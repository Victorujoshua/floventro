"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import { invoiceSchema, type InvoiceInput } from "@/lib/validation/invoices"
import { getInvoiceForReceiving } from "@/lib/db/queries/invoices"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string }

export async function recordInvoiceAction(
  input: InvoiceInput,
): Promise<ActionResult<{ invoiceId: string }>> {
  const parsed = invoiceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory", "admin")
  const supabase = await createAppServerClient()

  // Resolve which branch this invoice belongs to.
  let branchId: string
  if (scope.branchId) {
    branchId = scope.branchId
  } else if (parsed.data.branchId) {
    branchId = parsed.data.branchId
  } else {
    // Owner with no branch cookie and no branch selected — auto-resolve for single-branch orgs.
    const { data: branches } = await supabase
      .from("branches")
      .select("id")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)

    if (!branches || branches.length === 0) {
      return { ok: false, error: "No branches found in this organisation" }
    }
    if (branches.length > 1) {
      return { ok: false, error: "Select a branch", code: "branch_required" }
    }
    branchId = branches[0].id
  }

  // Convert each line from Naira to cents. Math.round prevents float drift.
  const lines = parsed.data.lines.map((line) => ({
    product_id: line.productId,
    quantity: line.quantity,
    unit_cost_cents: Math.round(line.unitCostNaira * 100),
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invoiceId, error } = await (supabase as any).rpc("record_vendor_invoice", {
    p_branch_id:      branchId,
    p_vendor_id:      parsed.data.vendorId,
    p_invoice_number: parsed.data.invoiceNumber || null,
    p_invoice_date:   parsed.data.invoiceDate,
    p_due_date:       parsed.data.dueDate || null,
    p_note:           parsed.data.note || null,
    p_lines:          lines,
    p_vat_rate:       parsed.data.vatRate ?? null,
  })

  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes("not authorised")) return { ok: false, error: "not_allowed", code: "not_allowed" }
    if (msg.includes("vendor not found")) return { ok: false, error: "bad_vendor", code: "bad_vendor" }
    if (msg.includes("not found") || msg.includes("does not belong")) {
      return { ok: false, error: "bad_product", code: "bad_product" }
    }
    return { ok: false, error: "server", code: "server" }
  }

  return { ok: true, data: { invoiceId: invoiceId as string } }
}

export async function getInvoiceForReceivingAction(invoiceId: string) {
  await requireRole("owner", "inventory", "admin")
  return getInvoiceForReceiving(invoiceId)
}

// Receives any batches, then closes any lines short — one transaction
// (receive_and_close_invoice_lines), so a failure in either rolls back both.
export async function receiveInvoiceStockAction(
  invoiceId: string,
  lines: { lineId: string; quantityReceived: number }[],
  note: string,
  closeShort: { lineIds: string[]; recordCredit: boolean } = { lineIds: [], recordCredit: false },
): Promise<{ ok: true; receiptStatus: string } | { ok: false; error: string; code?: string }> {
  await requireRole("owner", "inventory", "admin")
  const supabase = await createAppServerClient()

  const rpcLines = lines.map((l) => ({
    line_id: l.lineId,
    quantity_received: l.quantityReceived,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("receive_and_close_invoice_lines", {
    p_invoice_id: invoiceId,
    p_lines: rpcLines,
    p_close_line_ids: closeShort.lineIds,
    p_record_credit: closeShort.recordCredit,
    p_note: note || null,
  })

  if (error) {
    const msg = (error.message as string).toLowerCase()
    if (msg.includes("already fully received"))
      return { ok: false, error: "This invoice has already been fully received.", code: "already_received" }
    if (msg.includes("closed short"))
      return { ok: false, error: "This line or invoice has already been closed short.", code: "closed_short" }
    if (msg.includes("exceeds the outstanding balance"))
      return {
        ok: false,
        error:
          "The credit is more than this invoice's outstanding balance — the vendor would owe you a refund, which isn't supported yet. Close short without a credit instead.",
        code: "credit_exceeds_outstanding",
      }
    if (msg.includes("cannot receive more than ordered"))
      return { ok: false, error: error.message, code: "over_receive" }
    if (msg.includes("not authorised"))
      return { ok: false, error: "You don't have permission to receive stock for this invoice.", code: "not_allowed" }
    return { ok: false, error: "Something went wrong. Please try again.", code: "server" }
  }

  return { ok: true, receiptStatus: data as string }
}
