import { requireOwner } from "@/lib/auth/guards"
import { LedgerClient } from "./ledger-client"

export default async function LedgerPage() {
  await requireOwner()
  return <LedgerClient />
}
