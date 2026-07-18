import { redirect } from "next/navigation"
import { requireRole } from "@/lib/auth/guards"
import { getTransfers, getOrgBranches, getOrgProducts } from "@/lib/db/queries/transfers"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { TransfersClient } from "./transfers-client"

export default async function TransfersPage() {
  const scope = await requireRole("owner", "inventory")

  // Owner at org-level (no branch entered) has no source branch — send them to /org.
  if (scope.role === "owner" && !scope.branchId) {
    redirect("/org")
  }

  const supabase = await createAppServerClient()
  const [transfers, branches, products, branchData] = await Promise.all([
    getTransfers(),
    getOrgBranches(),
    getOrgProducts(),
    scope.branchId
      ? supabase.from("branches").select("name").eq("id", scope.branchId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return (
    <TransfersClient
      transfers={transfers}
      currentBranchId={scope.branchId ?? ""}
      currentBranchName={branchData.data?.name ?? ""}
      branches={branches}
      products={products}
    />
  )
}
