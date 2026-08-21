import { requireRole } from "@/lib/auth/guards"
import { getPlans } from "@/lib/db/queries/plans"
import { getActiveServiceTypes } from "@/lib/db/queries/services"
import { PlansClient } from "./plans-client"

export default async function PlansPage() {
  await requireRole("owner", "inventory", "admin", "sales")
  const [plans, serviceTypes] = await Promise.all([getPlans(), getActiveServiceTypes()])
  return <PlansClient initialPlans={plans} serviceTypes={serviceTypes} />
}
