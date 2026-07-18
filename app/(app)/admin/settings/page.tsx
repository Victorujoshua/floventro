import { requireOwner } from "@/lib/auth/guards"
import { getOrgPayoutAccount, getBranchesWithPayout } from "@/lib/db/queries/settings"
import { SettingsClient } from "./settings-client"

export default async function SettingsPage() {
  await requireOwner()
  const [orgPayout, branches] = await Promise.all([
    getOrgPayoutAccount(),
    getBranchesWithPayout(),
  ])
  return <SettingsClient orgPayout={orgPayout} branches={branches} />
}
