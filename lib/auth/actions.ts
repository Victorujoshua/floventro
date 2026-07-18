"use server"

import { redirect } from "next/navigation"
import { createAppServerClient } from "@/lib/supabase/app-server"
import {
  signUpSchema,
  signInSchema,
  type SignUpInput,
  type SignInInput,
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

  const { error } = await supabase.auth.signInWithPassword({
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
  const { data: { user } } = await supabase.auth.getUser()
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
