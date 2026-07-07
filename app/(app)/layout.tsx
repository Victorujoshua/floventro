import { getCurrentScope } from "@/lib/auth/scope"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { Sidebar } from "@/components/app/sidebar/sidebar"
import { AppHeader } from "@/components/app/header/app-header"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const scope = await getCurrentScope()

  // No scope = user is on onboarding or unauthenticated. Pass through —
  // onboarding has its own layout and pages handle their own auth guards.
  if (!scope) {
    return <>{children}</>
  }

  const supabase = await createAppServerClient()
  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", scope.organisationId)
    .maybeSingle()

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <Sidebar role={scope.role} />
      <div className="ml-60 flex flex-1 flex-col min-w-0">
        <AppHeader orgName={org?.name ?? ""} role={scope.role} />
        <main className="flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  )
}
