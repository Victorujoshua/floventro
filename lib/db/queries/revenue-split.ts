// ── Revenue split: paid at sale vs on credit ──────────────────────────────────
//
// A sale is CREDIT if payment_status is 'unpaid' or 'partial', OR it has at
// least one sale_payments row. record_sale_payment refuses payments beyond the
// outstanding balance, so a sale paid in full at the till can never gain a
// sale_payments row — any payment row means the sale started unpaid, even if it
// has since been settled. Everything else is PAID AT SALE, which includes all
// pre-app_0031 sales (defaulted to 'paid', no payment rows).
//
// Both buckets sum subtotal_cents (ex-VAT) so they reconcile exactly with the
// revenue headline. Classification uses the sale row itself — callers must feed
// the same rows (same created_at window and scope) they sum into revenue.

// Add to a sales .select() alongside subtotal_cents.
export const SALE_CREDIT_COLUMNS = "payment_status, sale_payments(id)"

export type RevenueSplit = {
  paidAtSaleCents: number
  creditCents: number
}

type SaleCreditFields = {
  subtotal_cents: number
  payment_status: string
  sale_payments: { id: string }[] | null
}

export function emptyRevenueSplit(): RevenueSplit {
  return { paidAtSaleCents: 0, creditCents: 0 }
}

export function isCreditSale(sale: Omit<SaleCreditFields, "subtotal_cents">): boolean {
  return (
    sale.payment_status === "unpaid" ||
    sale.payment_status === "partial" ||
    (sale.sale_payments?.length ?? 0) > 0
  )
}

export function addToRevenueSplit(split: RevenueSplit, sale: SaleCreditFields): void {
  if (isCreditSale(sale)) {
    split.creditCents += sale.subtotal_cents
  } else {
    split.paidAtSaleCents += sale.subtotal_cents
  }
}

// Every sale lands in exactly one bucket, so this can only fail if a caller
// splits a different row set than it sums into revenue.
export function checkRevenueSplit(split: RevenueSplit, totalCents: number, context: string): void {
  if (split.paidAtSaleCents + split.creditCents !== totalCents) {
    console.error(
      `[revenue-split] ${context}: paid at sale (${split.paidAtSaleCents}) + credit (${split.creditCents}) ≠ revenue (${totalCents})`,
    )
  }
}
