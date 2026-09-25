import { isCreditSale } from "./revenue-split"

// ── Cash inflow: money actually received in the window (VAT-inclusive) ───────
//
// Cash basis, not accrual. Two sources that never overlap:
//
//   Till cash      total_cents of sales in the window that were paid in full at
//                  the till. record_sale only accepts 'paid' (full total) or
//                  'unpaid' (0), and a till-paid sale can never gain a
//                  sale_payments row (overpayment is refused), so this is
//                  exactly what was collected at the point of sale.
//   Later payments sale_payments.amount_cents with paid_on in the window,
//                  whatever the age of the underlying sale.
//
// Never add sales.amount_paid_cents here: record_sale_payment folds every later
// payment into it, so summing it alongside sale_payments counts those payments
// twice. It is also 0 on pre-app_0031 sales that were in fact paid.

export type CashInflow = {
  tillCents: number
  laterPaymentsCents: number
}

export function emptyCashInflow(): CashInflow {
  return { tillCents: 0, laterPaymentsCents: 0 }
}

export function cashInflowTotal(c: CashInflow): number {
  return c.tillCents + c.laterPaymentsCents
}

type SaleTillFields = {
  total_cents: number
  payment_status: string
  sale_payments: { id: string }[] | null
}

// Feed the same rows (same created_at window and scope) that Revenue sums.
export function addTillCash(c: CashInflow, sale: SaleTillFields): void {
  if (!isCreditSale(sale)) c.tillCents += sale.total_cents
}

// paid_on is a date column; bound it by the cutoff's date and today so a
// future-dated entry can't be counted early. Both dates are UTC, matching the
// UTC timestamp cutoff used for the sales window.
export function paidOnWindow(cutoffIso: string): { from: string; to: string } {
  return { from: cutoffIso.slice(0, 10), to: new Date().toISOString().slice(0, 10) }
}
