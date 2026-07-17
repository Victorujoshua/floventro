import { requireRole } from "@/lib/auth/guards"
import { getServiceTypes } from "@/lib/db/queries/services"
import { ServicesClient } from "./services-client"

export default async function ServicesPage() {
  await requireRole("owner", "inventory")
  const serviceTypes = await getServiceTypes()
  return <ServicesClient serviceTypes={serviceTypes} />
}
