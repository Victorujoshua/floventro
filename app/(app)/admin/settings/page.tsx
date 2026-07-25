import { requireOwner } from "@/lib/auth/guards"
import { getOrgPayoutAccount, getBranchesWithPayout, getCostingMethod } from "@/lib/db/queries/settings"
import { SettingsClient } from "./settings-client"

export default async function SettingsPage() {
  await requireOwner()
  const [orgPayout, branches, costingMethod] = await Promise.all([
    getOrgPayoutAccount(),
    getBranchesWithPayout(),
    getCostingMethod(),
  ])
  return <SettingsClient orgPayout={orgPayout} branches={branches} costingMethod={costingMethod} />
}
