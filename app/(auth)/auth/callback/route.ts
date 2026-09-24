import { NextResponse, type NextRequest } from "next/server"
import { cookies } from "next/headers"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { RECOVERY_COOKIE, RECOVERY_COOKIE_OPTS } from "@/lib/auth/recovery"

// Target of the password-reset email link. Exchanges the one-time token_hash
// for a recovery session, marks it as such, then hands off to /reset-password.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type")

  const invalidLink = NextResponse.redirect(
    new URL("/forgot-password?error=invalid_link", request.url),
  )

  if (!tokenHash || type !== "recovery") {
    return invalidLink
  }

  const supabase = await createAppServerClient()
  const { data, error } = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: tokenHash,
  })

  if (error || !data.user) {
    return invalidLink
  }

  const cookieStore = await cookies()
  cookieStore.set(RECOVERY_COOKIE, data.user.id, RECOVERY_COOKIE_OPTS)

  return NextResponse.redirect(new URL("/reset-password", request.url))
}
