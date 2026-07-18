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

  const scope = await requireRole("owner", "inventory")
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

  const { data: invoiceId, error } = await supabase.rpc("record_vendor_invoice", {
    p_branch_id: branchId,
    p_vendor_id: parsed.data.vendorId,
    p_invoice_number: parsed.data.invoiceNumber || null,
    p_invoice_date: parsed.data.invoiceDate,
    p_due_date: parsed.data.dueDate || null,
    p_note: parsed.data.note || null,
    p_lines: lines,
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
  await requireRole("owner", "inventory")
  return getInvoiceForReceiving(invoiceId)
}

export async function receiveInvoiceStockAction(
  invoiceId: string,
  lines: { lineId: string; quantityReceived: number }[],
  note: string,
): Promise<{ ok: true; receiptStatus: string } | { ok: false; error: string; code?: string }> {
  await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const rpcLines = lines.map((l) => ({
    line_id: l.lineId,
    quantity_received: l.quantityReceived,
  }))

  const { data, error } = await supabase.rpc("receive_invoice_stock", {
    p_invoice_id: invoiceId,
    p_lines: rpcLines,
    p_note: note || null,
  })

  if (error) {
    const msg = error.message.toLowerCase()
    if (msg.includes("already fully received"))
      return { ok: false, error: "This invoice has already been fully received.", code: "already_received" }
    if (msg.includes("cannot receive more than ordered"))
      return { ok: false, error: error.message, code: "over_receive" }
    if (msg.includes("not authorised"))
      return { ok: false, error: "You don't have permission to receive stock for this invoice.", code: "not_allowed" }
    return { ok: false, error: "Something went wrong. Please try again.", code: "server" }
  }

  return { ok: true, receiptStatus: data as string }
}
