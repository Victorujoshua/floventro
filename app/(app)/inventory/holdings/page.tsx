import { requireRole } from "@/lib/auth/guards"
import { getBranchHoldings } from "@/lib/db/queries/holdings"
import { HoldingsOverviewClient } from "./holdings-overview-client"

export default async function HoldingsOverviewPage() {
  const scope = await requireRole("owner", "inventory")
  const branchId = scope.branchId ?? null
  const groups = await getBranchHoldings(branchId)
  return <HoldingsOverviewClient groups={groups} />
}
