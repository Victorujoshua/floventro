import { requireOwner } from "@/lib/auth/guards"
import { getOrgPayoutAccount } from "@/lib/db/queries/settings"
import { OrgSettingsClient } from "./org-settings-client"

export default async function OrgSettingsPage() {
  await requireOwner()
  const orgPayout = await getOrgPayoutAccount()
  return <OrgSettingsClient orgPayout={orgPayout} />
}
