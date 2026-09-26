import type { InvoiceForReceiving } from "@/lib/db/queries/invoices"

// Pure arithmetic behind the receive dialog — kept out of the component so the
// close-short and credit rules can be checked without rendering anything.

export type ReceivePlan = {
  // Undelivered units each line would close with, given what is received now
  shortfalls: number[]
  closingIndexes: number[]
  creditSubtotalCents: number
  creditVatCents: number
  creditCents: number
  // A credit larger than what is still owed would be a refund — not supported,
  // so the credit is dropped (closing short still goes ahead).
  creditBlocked: boolean
  fullyPaid: boolean
  // What is actually sent: the user's choice, unless the credit is blocked
  recordCredit: boolean
}

export function planReceipt(
  invoice: Pick<InvoiceForReceiving, "lines" | "vatRate" | "creditedSubtotalCents" | "outstandingCents">,
  quantities: number[],
  closeRest: boolean[],
  recordCredit: boolean,
): ReceivePlan {
  const shortfalls = invoice.lines.map((l, i) => l.remaining - (quantities[i] ?? 0))
  const closingIndexes = invoice.lines
    .map((_, i) => i)
    .filter((i) => closeRest[i] && shortfalls[i] > 0)

  // Same arithmetic as close_invoice_lines_short: each line's own unit cost ×
  // shortfall, VAT at the invoice rate with cumulative rounding.
  const creditSubtotalCents = closingIndexes.reduce(
    (sum, i) => sum + shortfalls[i] * invoice.lines[i].unitCostCents,
    0,
  )
  const vatRate = invoice.vatRate ?? 0
  const creditVatCents =
    Math.round((invoice.creditedSubtotalCents + creditSubtotalCents) * vatRate / 100) -
    Math.round(invoice.creditedSubtotalCents * vatRate / 100)
  const creditCents = creditSubtotalCents + creditVatCents
  const creditBlocked = closingIndexes.length > 0 && creditCents > invoice.outstandingCents

  return {
    shortfalls,
    closingIndexes,
    creditSubtotalCents,
    creditVatCents,
    creditCents,
    creditBlocked,
    fullyPaid: invoice.outstandingCents <= 0,
    recordCredit: recordCredit && !creditBlocked,
  }
}

// Ticking "Close rest" on a line that is set to receive everything would close
// nothing, so the line's "Receiving now" drops to 0 — the whole remainder is
// closed until the user enters what actually arrived.
export function toggleCloseRest(
  remaining: number,
  quantity: number,
  checked: boolean,
): { quantity: number; closeRest: boolean } {
  if (checked && remaining - quantity <= 0) return { quantity: 0, closeRest: true }
  return { quantity, closeRest: checked }
}
