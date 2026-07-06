import { requireScope } from "@/lib/auth/guards"

export default async function DashboardPage() {
  const scope = await requireScope()

  return (
    <div className="p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
      <p className="text-sm text-neutral-500 mt-1">
        Scope debug: organisation {scope.organisationId}, role {scope.role},{" "}
        branch {scope.branchId ?? "ALL"}
      </p>
    </div>
  )
}
