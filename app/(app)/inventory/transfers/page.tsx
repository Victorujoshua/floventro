import { redirect } from "next/navigation"
import { requireRole } from "@/lib/auth/guards"
import { getTransfers, getOrgBranches, getOrgProducts } from "@/lib/db/queries/transfers"
import { getBranchTransferRequests } from "@/lib/db/queries/transfer-requests"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { TransfersClient } from "./transfers-client"

export default async function TransfersPage() {
  const scope = await requireRole("owner", "inventory", "admin")

  // Owner at org-level (no branch entered) has no source branch — send them to /org.
  if (scope.role === "owner" && !scope.branchId) {
    redirect("/org")
  }

  const supabase = await createAppServerClient()
  const [transfers, requests, branches, products, branchData] = await Promise.all([
    getTransfers(),
    getBranchTransferRequests(),
    getOrgBranches(),
    getOrgProducts(),
    scope.branchId
      ? supabase.from("branches").select("name").eq("id", scope.branchId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return (
    <TransfersClient
      transfers={transfers}
      requests={requests}
      currentBranchId={scope.branchId ?? ""}
      currentBranchName={branchData.data?.name ?? ""}
      currentUserId={scope.userId}
      // Direct send is owner/admin only (app_0075); inventory requests instead.
      canDirectSend={scope.role === "owner" || scope.role === "admin"}
      branches={branches}
      products={products}
    />
  )
}
