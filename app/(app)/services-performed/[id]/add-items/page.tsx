import { redirect } from "next/navigation"
import { requireRole } from "@/lib/auth/guards"
import { getServiceRecordById } from "@/lib/db/queries/services"
import { getServiceItems } from "@/lib/db/queries/service-items"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { AddItemsClient, type ServiceItemEntry } from "./add-items-client"

export default async function AddItemsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole("internal_use")
  const { id } = await params

  const supabase = await createAppServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/services-performed")

  const [record, allServiceItems] = await Promise.all([
    getServiceRecordById(id),
    getServiceItems(),
  ])

  if (!record) redirect("/services-performed")
  if (record.performedByUserId !== user.id) redirect("/services-performed")

  const serviceItems: ServiceItemEntry[] = allServiceItems
    .filter((si) => si.isActive)
    .map((si) => ({
      id: si.id,
      name: si.name,
      category: si.category,
      amountCents: si.amountCents,
      packageSize: si.packageSize,
      measurementName: si.measurementName,
      measurementSymbol: si.measurementSymbol,
    }))

  return (
    <AddItemsClient
      recordId={record.id}
      serviceTypeName={record.serviceTypeName}
      customerName={record.customerName}
      performedOn={record.performedOn}
      serviceItems={serviceItems}
    />
  )
}
