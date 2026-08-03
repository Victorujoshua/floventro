import { redirect } from "next/navigation"
import { requireScope } from "@/lib/auth/guards"
import { getFulfilmentOrders } from "@/lib/db/queries/fulfilment"
import { getProducts } from "@/lib/db/queries/products"
import { getHiddenFeatures } from "@/lib/db/queries/features"
import { FulfilmentClient } from "./fulfilment-client"

export default async function FulfilmentPage() {
  const scope = await requireScope()

  // Feature visibility backstop — redirect if fulfilment is hidden for this role in this branch.
  if (scope.branchId) {
    const hidden = await getHiddenFeatures(scope.branchId, scope.role)
    if (hidden.includes("fulfilment")) redirect("/dashboard")
  }

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
