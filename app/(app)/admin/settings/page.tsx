import { requireOwner } from "@/lib/auth/guards"
import { getBranchesWithPayout } from "@/lib/db/queries/settings"
import { SettingsClient } from "./settings-client"

export default async function SettingsPage() {
  await requireOwner()
  const branches = await getBranchesWithPayout()
  return <SettingsClient branches={branches} />
}
