import { requireRole } from "@/lib/auth/guards"
import { getClients } from "@/lib/db/queries/clients"
import { ClientsClient } from "./clients-client"

export default async function ClientsPage() {
  await requireRole("owner", "inventory", "admin", "sales")
  const clients = await getClients()
  return <ClientsClient initialClients={clients} />
}
