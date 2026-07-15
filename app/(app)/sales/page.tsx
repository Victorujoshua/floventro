import { requireScope } from "@/lib/auth/guards"
import { getSales } from "@/lib/db/queries/sales"
import { SalesClient } from "./sales-client"

export default async function SalesPage() {
  await requireScope()
  const sales = await getSales()
  return <SalesClient sales={sales} />
}
