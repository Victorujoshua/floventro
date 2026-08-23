import { requireRole } from "@/lib/auth/guards"
import { getMeasurements, getServiceItems } from "@/lib/db/queries/service-items"
import { getProducts } from "@/lib/db/queries/products"
import { ServiceItemsClient } from "./service-items-client"

export default async function ServiceItemsPage() {
  await requireRole("owner", "inventory", "admin", "sales")
  const [items, measurements, products] = await Promise.all([
    getServiceItems(),
    getMeasurements(),
    getProducts(),
  ])
  return (
    <ServiceItemsClient
      initialItems={items}
      initialMeasurements={measurements}
      products={products.map((p) => ({ id: p.id, name: p.name, sku: p.sku }))}
    />
  )
}
