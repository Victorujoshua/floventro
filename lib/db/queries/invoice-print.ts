import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"
import { getEffectivePayoutAccount, type PayoutAccount } from "./settings"

export type InvoiceLine = {
  id: string
  productName: string
  productSku: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}

export type SaleInvoiceData = {
  invoiceNumber: string
  orgName: string
  branchName: string
  soldOn: string
  customerName: string | null
  customerPhone: string | null
  paymentStatus: string
  totalCents: number
  amountPaidCents: number
  outstandingCents: number
  lines: InvoiceLine[]
  payoutAccount: PayoutAccount | null
}

export async function getSaleInvoiceData(saleId: string): Promise<SaleInvoiceData | null> {
  const scope = await getCurrentScope()
  if (!scope) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("sales")
    .select(
      "id, sold_on, customer_name, customer_phone, payment_status, amount_paid_cents, total_cents, branch_id, organisation_id, sale_lines(id, product_id, quantity, unit_price_cents, line_total_cents, products(name, sku))",
    )
    .eq("id", saleId)
    .single()

  if (error || !data) return null

  type RawLine = {
    id: string
    product_id: string
    quantity: number
    unit_price_cents: number
    line_total_cents: number
    products: { name: string; sku: string } | { name: string; sku: string }[] | null
  }

  const [orgResult, branchResult, payoutAccount] = await Promise.all([
    supabase
      .from("organisations")
      .select("name")
      .eq("id", data.organisation_id)
      .single(),
    supabase
      .from("branches")
      .select("name")
      .eq("id", data.branch_id)
      .single(),
    getEffectivePayoutAccount(data.branch_id),
  ])

  const lines = ((data.sale_lines ?? []) as RawLine[]).map((l) => {
    const prod = Array.isArray(l.products) ? l.products[0] : l.products
    return {
      id: l.id,
      productName: prod?.name ?? "Unknown product",
      productSku: prod?.sku ?? "",
      quantity: l.quantity,
      unitPriceCents: l.unit_price_cents,
      lineTotalCents: l.line_total_cents,
    }
  })

  return {
    invoiceNumber: `INV-${data.id.slice(0, 8).toUpperCase()}`,
    orgName: (orgResult.data?.name as string | null) ?? "Your Organisation",
    branchName: (branchResult.data?.name as string | null) ?? "",
    soldOn: data.sold_on as string,
    customerName: data.customer_name as string | null,
    customerPhone: data.customer_phone as string | null,
    paymentStatus: data.payment_status as string,
    totalCents: data.total_cents as number,
    amountPaidCents: data.amount_paid_cents as number,
    outstandingCents: (data.total_cents as number) - (data.amount_paid_cents as number),
    lines,
    payoutAccount,
  }
}
