import { requireOwner } from "@/lib/auth/guards"

export default async function OrgSalesPage() {
  await requireOwner()

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Sales &amp; Revenue</h1>
      <p className="text-sm text-neutral-500 mt-1">Org-wide sales analytics — coming in Phase 8.2</p>
    </div>
  )
}
