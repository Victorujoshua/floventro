import { requireScope } from "@/lib/auth/guards"
import { getFulfilmentOrders } from "@/lib/db/queries/fulfilment"
import { getProducts } from "@/lib/db/queries/products"
import { FulfilmentClient } from "./fulfilment-client"

export default async function FulfilmentPage() {
  const scope = await requireScope()
  const [orders, products] = await Promise.all([
    getFulfilmentOrders(),
    getProducts(),
  ])

  return (
    <FulfilmentClient
      orders={orders}
      products={products}
      role={scope.role}
      hasBranch={!!scope.branchId}
    />
  )
}
