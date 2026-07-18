import { requireRole } from "@/lib/auth/guards"
import { getTransfers, getOrgBranches, getOrgProducts } from "@/lib/db/queries/transfers"
import { TransfersClient } from "./transfers-client"

export default async function TransfersPage() {
  await requireRole("owner", "inventory")

  const [transfers, branches, products] = await Promise.all([
    getTransfers(),
    getOrgBranches(),
    getOrgProducts(),
  ])

  return <TransfersClient transfers={transfers} branches={branches} products={products} />
}
