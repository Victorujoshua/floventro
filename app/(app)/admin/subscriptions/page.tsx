import { requireRole } from "@/lib/auth/guards"
import { getClientPlans } from "@/lib/db/queries/plans"
import { getActivePlanSummaries } from "@/lib/db/queries/plans"
import { SubscriptionsClient } from "./subscriptions-client"

export default async function SubscriptionsPage() {
  await requireRole("owner", "admin", "sales")
  const [clientPlans, activePlans] = await Promise.all([
    getClientPlans(),
    getActivePlanSummaries(),
  ])
  return <SubscriptionsClient initialClientPlans={clientPlans} activePlans={activePlans} />
}
