"use server"

import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { after } from "next/server"
import {
  createAppServerClient,
  createAppServiceRoleClient,
} from "@/lib/supabase/app-server"
import { sendPasswordResetEmail } from "@/lib/email/zeptomail"
import { RECOVERY_COOKIE } from "@/lib/auth/recovery"
import {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type SignUpInput,
  type SignInInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from "@/lib/validation/auth"
import {
  createOrgSchema,
  type CreateOrgInput,
} from "@/lib/validation/onboarding"

type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string; code?: string }

export async function signUpAction(input: SignUpInput): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "invalid", code: "validation" }
  }

  const supabase = await createAppServerClient()

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
      },
    },
  })

  if (error) {
    if (
      error.message.toLowerCase().includes("already") ||
      error.code === "user_already_exists"
    ) {
      return { ok: false, error: "account_exists", code: "account_exists" }
    }
    console.error("signUpAction failed:", error)
    return { ok: false, error: "server", code: "server" }
  }

  return { ok: true }
}

function safeNext(next?: string): string | null {
  if (!next) return null
  if (!next.startsWith("/")) return null
  if (next.startsWith("//")) return null
  if (next.includes("://")) return null
  return next
}

export async function signInAction(input: SignInInput, next?: string): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "invalid", code: "validation" }
  }

  const supabase = await createAppServerClient()

  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    if (error.message.toLowerCase().includes("invalid") || error.status === 400) {
      return { ok: false, error: "invalid_credentials", code: "invalid_credentials" }
    }
    console.error("signInAction failed:", error)
    return { ok: false, error: "server", code: "server" }
  }

  // If a safe deep-link was provided, honour it (invite flows, bookmarks).
  const nextUrl = safeNext(next)
  if (nextUrl) redirect(nextUrl)

  // Owner lands on /org; everyone else lands on /dashboard.
  const user = signInData.user
  if (user) {
    const { data: ownerMem } = await supabase
      .from("memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "owner")
      .is("branch_id", null)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle()
    if (ownerMem) redirect("/org")
  }

  redirect("/dashboard")
}

export async function signOutAction(): Promise<void> {
  const supabase = await createAppServerClient()
  await supabase.auth.signOut()
  redirect("/login")
}

export async function requestPasswordResetAction(
  input: ForgotPasswordInput,
): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "invalid", code: "validation" }
  }

  const email = parsed.data.email.trim().toLowerCase()

  // Account-enumeration protection: the caller always gets the same
  // { ok: true } straight away. Generating the link and sending the email run
  // after the response is sent, so neither the outcome (user found / not
  // found / send failed) nor the response time can reveal whether an account
  // exists for this email.
  after(async () => {
    await sendPasswordResetLink(email)
  })

  return { ok: true }
}

async function sendPasswordResetLink(email: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.floventro.com"
  const admin = createAppServiceRoleClient()

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  })

  if (error || !data.properties?.hashed_token) {
    // No account for this email is the expected case here — Supabase returns
    // an error instead of a link. Log only unexpected failures, never the email.
    if (error?.status !== 404 && error?.code !== "user_not_found") {
      console.error("[password-reset] generateLink failed:", error?.code ?? "no_token", error?.status)
    }
    return
  }

  // Point at our own callback (verifyOtp with token_hash) rather than
  // Supabase's action_link, so the flow never goes through Supabase's hosted
  // verify page.
  const resetUrl = new URL("/auth/callback", appUrl)
  resetUrl.searchParams.set("token_hash", data.properties.hashed_token)
  resetUrl.searchParams.set("type", "recovery")

  const result = await sendPasswordResetEmail({ email, resetUrl: resetUrl.toString() })
  if (!result.ok) {
    console.error("[password-reset] email send failed:", result.error)
  }
}

export async function resetPasswordAction(
  input: ResetPasswordInput,
): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "invalid", code: "validation" }
  }

  const supabase = await createAppServerClient()
  const cookieStore = await cookies()

  // Only a session established by /auth/callback may change the password here.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || cookieStore.get(RECOVERY_COOKIE)?.value !== user.id) {
    return { ok: false, error: "session_missing", code: "session_missing" }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

  if (error) {
    if (error.code === "same_password" || error.code === "weak_password") {
      return { ok: false, error: error.code, code: error.code }
    }
    console.error("resetPasswordAction failed:", error)
    return { ok: false, error: "server", code: "server" }
  }

  cookieStore.delete(RECOVERY_COOKIE)

  // Revoke every session, including any an attacker may hold, so the user
  // signs in fresh with the new password.
  await supabase.auth.signOut({ scope: "global" })

  redirect("/login?reset=success")
}

export async function createOrgAction(
  input: CreateOrgInput,
): Promise<ActionResult> {
  const parsed = createOrgSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "invalid", code: "validation" }
  }

  const supabase = await createAppServerClient()

  const { data: newOrgId, error } = await supabase.rpc("create_organisation", {
    org_name: parsed.data.name,
    country_code: parsed.data.countryCode,
    currency: parsed.data.currency,
    timezone: parsed.data.timezone,
  })

  if (error) {
    console.error("createOrgAction failed:", error)
    return { ok: false, error: "server", code: "server" }
  }

  redirect("/org")
}
