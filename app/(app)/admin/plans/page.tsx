import { requireRole } from "@/lib/auth/guards"
import { getPlans } from "@/lib/db/queries/plans"
import { getActiveServiceTypes } from "@/lib/db/queries/services"
import { PlansClient } from "./plans-client"

const SERVICE_TYPE_CREATE_ROLES = ["owner", "inventory", "admin", "sales"] as const

export default async function PlansPage() {
  const scope = await requireRole("owner", "inventory", "admin", "sales")
  const canCreateServiceType = (SERVICE_TYPE_CREATE_ROLES as readonly string[]).includes(scope.role)
  const [plans, serviceTypes] = await Promise.all([getPlans(), getActiveServiceTypes()])
  return (
    <PlansClient
      initialPlans={plans}
      serviceTypes={serviceTypes}
      canCreateServiceType={canCreateServiceType}
    />
  )
}
