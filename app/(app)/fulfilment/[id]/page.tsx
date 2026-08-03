import { notFound } from "next/navigation"
import { requireScope } from "@/lib/auth/guards"
import { getFulfilmentOrderById } from "@/lib/db/queries/fulfilment"
import { FulfilmentDetailClient } from "./fulfilment-detail-client"

export default async function FulfilmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const scope = await requireScope()
  const order = await getFulfilmentOrderById(id)

  if (!order) notFound()

  return <FulfilmentDetailClient order={order} role={scope.role} />
}
