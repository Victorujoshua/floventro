import { redirect } from "next/navigation"
import { requireRole } from "@/lib/auth/guards"
import { getServiceRecordById } from "@/lib/db/queries/services"
import { getMyHoldings } from "@/lib/db/queries/holdings"
import { getProducts } from "@/lib/db/queries/products"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { AddItemsClient, type CatalogItem } from "./add-items-client"

export default async function AddItemsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole("internal_use")
  const { id } = await params

  const supabase = await createAppServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/services-performed")

  const [record, myHoldings, allProducts] = await Promise.all([
    getServiceRecordById(id),
    getMyHoldings(),
    getProducts(),
  ])

  if (!record) redirect("/services-performed")
  if (record.performedByUserId !== user.id) redirect("/services-performed")

  const holdingMap = new Map(myHoldings.map((h) => [h.productId, h.quantity]))
  const catalog: CatalogItem[] = allProducts.map((p) => ({
    productId: p.id,
    productName: p.name,
    productSku: p.sku,
    holdingQty: holdingMap.get(p.id) ?? 0,
  }))

  return (
    <AddItemsClient
      recordId={record.id}
      serviceTypeName={record.serviceTypeName}
      customerName={record.customerName}
      performedOn={record.performedOn}
      catalog={catalog}
    />
  )
}
