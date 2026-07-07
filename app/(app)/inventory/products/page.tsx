import { requireRole } from "@/lib/auth/guards"
import { getProducts } from "@/lib/db/queries/products"
import { ProductsClient } from "./products-client"

export default async function ProductsPage() {
  await requireRole("owner", "inventory")
  const products = await getProducts()

  return <ProductsClient products={products} />
}
