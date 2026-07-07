import { redirect } from "next/navigation"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { CreateOrgForm } from "./create-org-form"

export default async function CreateOrgPage() {
  const supabase = await createAppServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  // If the user already belongs to an org, they don't need to create one.
  const { data: memberships } = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)

  console.log('[create-org page] user:', user ? user.id.slice(0, 8) : 'NULL')
  console.log('[create-org page] memberships found:', memberships?.length ?? 'null')

  if (memberships && memberships.length > 0) {
    redirect("/dashboard")
  }

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-950">Create your organisation</h1>
        <p className="mt-1 text-sm text-neutral-500">
          We&apos;ll set up your first branch automatically — you can rename it or add more later from Settings.
        </p>
      </div>
      <CreateOrgForm />
    </div>
  )
}
