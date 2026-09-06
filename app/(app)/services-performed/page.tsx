import { requireRole } from "@/lib/auth/guards"
import { getServiceRecords, getMyJobCostingSessions } from "@/lib/db/queries/services"
import { ServicesPerformedClient } from "./services-performed-client"

export default async function ServicesPerformedPage() {
  const scope = await requireRole("internal_use")
  const [records, jobCostingSessions] = await Promise.all([
    getServiceRecords(),
    scope.role === "internal_use" ? getMyJobCostingSessions() : Promise.resolve([]),
  ])
  return (
    <ServicesPerformedClient
      records={records}
      jobCostingSessions={jobCostingSessions}
      role={scope.role}
      currentUserId={scope.userId}
    />
  )
}
