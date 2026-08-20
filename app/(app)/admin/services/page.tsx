import { requireRole } from "@/lib/auth/guards"
import { getServiceTypes } from "@/lib/db/queries/services"
import { ServicesClient } from "./services-client"

export default async function ServicesPage() {
  await requireRole("owner", "inventory", "admin", "sales")
  const services = await getServiceTypes()
  return <ServicesClient initialServices={services} />
}
