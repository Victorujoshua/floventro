import { requireOwner } from "@/lib/auth/guards"
import { getOrgBranchRows } from "@/lib/db/queries/branches"
import { BranchesClient } from "./branches-client"

export default async function BranchesPage() {
  await requireOwner()
  const branches = await getOrgBranchRows()
  return <BranchesClient branches={branches} />
}
