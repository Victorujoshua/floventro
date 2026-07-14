import { requireRole } from "@/lib/auth/guards"
import { getPendingRequests, getReviewedRequests } from "@/lib/db/queries/requests"
import { RequestsReviewClient } from "./requests-review-client"

export default async function InventoryRequestsPage() {
  await requireRole("owner", "inventory")

  const [pendingRequests, reviewedRequests] = await Promise.all([
    getPendingRequests(),
    getReviewedRequests(30),
  ])

  return (
    <RequestsReviewClient
      pendingRequests={pendingRequests}
      reviewedRequests={reviewedRequests}
    />
  )
}
