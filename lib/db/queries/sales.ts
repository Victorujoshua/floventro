import { createAppServerClient, createAppServiceRoleClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export type SaleRow = {
  id: string
  soldOn: string
  sellerUserId: string
  sellerLabel: string
  customerName: string | null
  customerPhone: string | null
  totalCents: number
  lineCount: number
  createdAt: string
}

export type SaleLine = {
  id: string
  productId: string
  productName: string
  productSku: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}

export type SaleDetail = SaleRow & {
  note: string | null
  lines: SaleLine[]
}

type RawSaleRow = {
  id: string
  sold_on: string
  seller_user_id: string
  customer_name: string | null
  customer_phone: string | null
  total_cents: number
  created_at: string
  sale_lines: { count: number }[]
}

type RawSaleLineRow = {
  id: string
  product_id: string
  quantity: number
  unit_price_cents: number
  line_total_cents: number
  products: { name: string; sku: string } | { name: string; sku: string }[] | null
}

type RawSaleDetail = {
  id: string
  sold_on: string
  seller_user_id: string
  customer_name: string | null
  customer_phone: string | null
  total_cents: number
  note: string | null
  created_at: string
  sale_lines: RawSaleLineRow[]
}

function resolveProduct(raw: RawSaleLineRow["products"]): { name: string; sku: string } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

async function fetchSellerMap(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (ids.length === 0) return map
  const admin = createAppServiceRoleClient()
  await Promise.all(
    ids.map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid)
      const name = (data.user?.user_metadata?.full_name as string) || data.user?.email || uid
      map.set(uid, name)
    })
  )
  return map
}

export async function getSales(): Promise<SaleRow[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const { data, error } = await supabase
    .from("sales")
    .select("id, sold_on, seller_user_id, customer_name, customer_phone, total_cents, created_at, sale_lines(count)")
    .order("created_at", { ascending: false })
    .limit(100)

  if (error || !data) return []

  const rows = data as RawSaleRow[]
  const sellerIds = [...new Set(rows.map((r) => r.seller_user_id))]
  const sellerMap = await fetchSellerMap(sellerIds)

  return rows.map((row) => ({
    id: row.id,
    soldOn: row.sold_on,
    sellerUserId: row.seller_user_id,
    sellerLabel: sellerMap.get(row.seller_user_id) ?? row.seller_user_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    totalCents: row.total_cents,
    lineCount: (row.sale_lines as unknown as { count: number }[])?.[0]?.count ?? row.sale_lines?.length ?? 0,
    createdAt: row.created_at,
  }))
}

export async function getSaleById(id: string): Promise<SaleDetail | null> {
  const scope = await getCurrentScope()
  if (!scope) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const { data, error } = await supabase
    .from("sales")
    .select("id, sold_on, seller_user_id, customer_name, customer_phone, total_cents, note, created_at, sale_lines(id, product_id, quantity, unit_price_cents, line_total_cents, products(name, sku))")
    .eq("id", id)
    .single()

  if (error || !data) return null

  const row = data as RawSaleDetail
  const sellerMap = await fetchSellerMap([row.seller_user_id])

  return {
    id: row.id,
    soldOn: row.sold_on,
    sellerUserId: row.seller_user_id,
    sellerLabel: sellerMap.get(row.seller_user_id) ?? row.seller_user_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    totalCents: row.total_cents,
    note: row.note,
    lineCount: row.sale_lines.length,
    createdAt: row.created_at,
    lines: row.sale_lines.map((l) => {
      const product = resolveProduct(l.products)
      return {
        id: l.id,
        productId: l.product_id,
        productName: product?.name ?? "Unknown product",
        productSku: product?.sku ?? "",
        quantity: l.quantity,
        unitPriceCents: l.unit_price_cents,
        lineTotalCents: l.line_total_cents,
      }
    }),
  }
}
