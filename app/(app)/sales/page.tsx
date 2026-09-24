import { requireRole, SALE_PAYMENT_ROLES } from "@/lib/auth/guards"
import { getSales } from "@/lib/db/queries/sales"
import { SalesClient } from "./sales-client"

export default async function SalesPage() {
  const scope = await requireRole("sales", "admin", "owner", "inventory")
  const sales = await getSales()
  return <SalesClient sales={sales} canRecordPayments={SALE_PAYMENT_ROLES.includes(scope.role)} />
}
