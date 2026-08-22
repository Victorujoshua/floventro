import { redirect } from "next/navigation"
import { requireRole } from "@/lib/auth/guards"
import { getServiceRecordById } from "@/lib/db/queries/services"
import { getMyHoldings } from "@/lib/db/queries/holdings"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { AddItemsClient } from "./add-items-client"

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

  const [record, holdings] = await Promise.all([
    getServiceRecordById(id),
    getMyHoldings(),
  ])

  if (!record) redirect("/services-performed")
  if (record.performedByUserId !== user.id) redirect("/services-performed")
  if (record.consumptionCount > 0) redirect("/services-performed")

  return (
    <AddItemsClient
      recordId={record.id}
      serviceTypeName={record.serviceTypeName}
      customerName={record.customerName}
      performedOn={record.performedOn}
      holdings={holdings}
    />
  )
}
