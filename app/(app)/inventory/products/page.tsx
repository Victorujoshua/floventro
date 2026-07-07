import { requireRole } from "@/lib/auth/guards"
import { getProducts } from "@/lib/db/queries/products"
import { ProductsClient } from "./products-client"

export default async function ProductsPage() {
  await requireRole("owner", "inventory")
  const products = await getProducts()

  return (
    <div className="px-8 py-6">
      <ProductsClient products={products} />
    </div>
  )
}
