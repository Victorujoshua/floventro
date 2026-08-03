import { redirect } from "next/navigation"
import { requireRole } from "@/lib/auth/guards"
import { getCurrentBranchPayout } from "@/lib/db/queries/settings"
import { getFeatureVisibilityForBranch } from "@/lib/db/queries/features"
import { SettingsClient } from "./settings-client"

export default async function SettingsPage() {
  const scope = await requireRole("owner", "admin")
  const branch = await getCurrentBranchPayout()
  if (!branch) redirect("/dashboard")
  const featureVisibility = await getFeatureVisibilityForBranch(branch.id)
  return <SettingsClient branch={branch} userRole={scope.role} hiddenFeatures={featureVisibility} />
}
