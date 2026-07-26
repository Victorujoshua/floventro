import { requireOwner } from "@/lib/auth/guards"
import { getOrgPayoutAccount, getCostingMethod } from "@/lib/db/queries/settings"
import { OrgSettingsClient } from "./org-settings-client"

export default async function OrgSettingsPage() {
  await requireOwner()
  const [orgPayout, costingMethod] = await Promise.all([
    getOrgPayoutAccount(),
    getCostingMethod(),
  ])
  return <OrgSettingsClient orgPayout={orgPayout} costingMethod={costingMethod} />
}
