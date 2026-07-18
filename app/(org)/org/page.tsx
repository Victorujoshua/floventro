import { requireOwner } from "@/lib/auth/guards"
import { createAppServerClient } from "@/lib/supabase/app-server"

export default async function OrgOverviewPage() {
  const scope = await requireOwner()

  const supabase = await createAppServerClient()
  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", scope.organisationId)
    .maybeSingle()

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">
        {org?.name ?? "Organization"}
      </h1>
      <p className="text-sm text-neutral-500 mt-1">
        Organization overview — enter a branch from the sidebar to view branch data.
      </p>

      <div className="mt-10 rounded-2xl border border-neutral-200/60 bg-white px-8 py-12 text-center max-w-lg mx-auto">
        <p className="text-sm font-medium text-neutral-950">
          Org-level analytics coming in Phase 8.2
        </p>
        <p className="text-sm text-neutral-500 mt-1">
          Select a branch from the left sidebar to enter it and view its dashboard, stock, and reports.
        </p>
      </div>
    </div>
  )
}
