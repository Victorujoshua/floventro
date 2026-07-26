import { redirect } from "next/navigation"
import { requireOwner } from "@/lib/auth/guards"
import { getCurrentBranchPayout } from "@/lib/db/queries/settings"
import { SettingsClient } from "./settings-client"

export default async function SettingsPage() {
  await requireOwner()
  const branch = await getCurrentBranchPayout()
  if (!branch) redirect("/org")
  return <SettingsClient branch={branch} />
}
