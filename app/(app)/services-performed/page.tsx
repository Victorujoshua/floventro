import { requireScope } from "@/lib/auth/guards"
import { getServiceRecords } from "@/lib/db/queries/services"
import { ServicesPerformedClient } from "./services-performed-client"

export default async function ServicesPerformedPage() {
  await requireScope()
  const records = await getServiceRecords()
  return <ServicesPerformedClient records={records} />
}
