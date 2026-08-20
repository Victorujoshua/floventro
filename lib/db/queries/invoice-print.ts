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

export type InvoiceServiceLine = {
  id: string
  serviceName: string
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
  subtotalCents: number
  vatRate: number | null
  vatCents: number
  totalCents: number
  amountPaidCents: number
  outstandingCents: number
  lines: InvoiceLine[]
  serviceLines: InvoiceServiceLine[]
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
      "id, sold_on, customer_name, customer_phone, payment_status, amount_paid_cents, subtotal_cents, vat_rate, vat_cents, total_cents, branch_id, organisation_id, sale_lines(id, product_id, quantity, unit_price_cents, line_total_cents, products(name, sku)), sale_service_lines(id, service_name, quantity, unit_price_cents, line_total_cents)",
    )
    .eq("id", saleId)
    .eq("organisation_id", scope.organisationId)
    .maybeSingle()

  if (error || !data) return null

  type RawLine = {
    id: string
    product_id: string
    quantity: number
    unit_price_cents: number
    line_total_cents: number
    products: { name: string; sku: string } | { name: string; sku: string }[] | null
  }

  type RawServiceLine = {
    id: string
    service_name: string
    quantity: number
    unit_price_cents: number
    line_total_cents: number
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

  const serviceLines = ((data.sale_service_lines ?? []) as RawServiceLine[]).map((l) => ({
    id: l.id,
    serviceName: l.service_name,
    quantity: l.quantity,
    unitPriceCents: l.unit_price_cents,
    lineTotalCents: l.line_total_cents,
  }))

  return {
    invoiceNumber: `INV-${data.id.slice(0, 8).toUpperCase()}`,
    orgName: (orgResult.data?.name as string | null) ?? "Your Organisation",
    branchName: (branchResult.data?.name as string | null) ?? "",
    soldOn: data.sold_on as string,
    customerName: data.customer_name as string | null,
    customerPhone: data.customer_phone as string | null,
    paymentStatus: data.payment_status as string,
    subtotalCents: data.subtotal_cents as number,
    vatRate: data.vat_rate as number | null,
    vatCents: data.vat_cents as number,
    totalCents: data.total_cents as number,
    amountPaidCents: data.amount_paid_cents as number,
    outstandingCents: (data.total_cents as number) - (data.amount_paid_cents as number),
    lines,
    serviceLines,
    payoutAccount,
  }
}
