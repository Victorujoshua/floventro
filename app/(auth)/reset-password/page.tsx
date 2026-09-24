import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { RECOVERY_COOKIE } from "@/lib/auth/recovery"
import { ResetPasswordForm } from "./reset-password-form"

export default async function ResetPasswordPage() {
  const supabase = await createAppServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const cookieStore = await cookies()

  // Reachable only via /auth/callback: needs a session AND the recovery marker
  // for that same user. An ordinary logged-in session isn't enough.
  if (!user || cookieStore.get(RECOVERY_COOKIE)?.value !== user.id) {
    redirect("/forgot-password?error=session_missing")
  }

  return <ResetPasswordForm email={user.email ?? ""} />
}
