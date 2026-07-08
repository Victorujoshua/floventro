import { requireRole } from "@/lib/auth/guards"
import { getVendors, getOrgBranches } from "@/lib/db/queries/vendors"
import { VendorsClient } from "./vendors-client"

export default async function VendorsPage() {
  await requireRole("owner", "inventory")
  const [vendors, branches] = await Promise.all([getVendors(), getOrgBranches()])

  return <VendorsClient vendors={vendors} branches={branches} />
}
