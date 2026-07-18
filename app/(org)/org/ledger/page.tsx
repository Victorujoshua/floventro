import { requireOwner } from "@/lib/auth/guards"

export default async function OrgLedgerPage() {
  await requireOwner()

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Org Ledger</h1>
      <p className="text-sm text-neutral-500 mt-1">Cross-branch ledger — coming in Phase 8.2</p>
    </div>
  )
}
