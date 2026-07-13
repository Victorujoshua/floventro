"use server"

import { redirect } from "next/navigation"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { setCurrentScope, type Role } from "@/lib/auth/scope"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string }

type AcceptError =
  | "not_found"
  | "invalid"
  | "expired"
  | "wrong_email"
  | "unauthenticated"
  | "server"

function mapRpcError(msg: string): AcceptError {
  const m = msg.toLowerCase()
  if (m.includes("not found")) return "not_found"
  if (m.includes("no longer valid")) return "invalid"
  if (m.includes("expired")) return "expired"
  if (m.includes("different email")) return "wrong_email"
  if (m.includes("not authenticated")) return "unauthenticated"
  return "server"
}

export async function acceptInviteAction(
  token: string,
): Promise<ActionResult<{ organisationId: string }>> {
  const supabase = await createAppServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not authenticated", code: "unauthenticated" }

  const { data: orgId, error } = await supabase.rpc("accept_invitation", {
    p_token: token,
  })

  if (error) {
    return { ok: false, error: error.message, code: mapRpcError(error.message) }
  }

  const organisationId = orgId as string

  // Set scope cookie so they land in the right workspace immediately.
  // We don't know the role/branch from here — getCurrentScope will resolve it
  // on next load. Just clear any stale scope by writing the new org.
  // setCurrentScope requires a known membership; skip it — the middleware
  // will resolve it naturally on redirect.
  void setCurrentScope({ organisationId, branchId: null, role: "inventory" as Role })

  return { ok: true, data: { organisationId } }
}

export async function signUpAndAcceptAction(
  token: string,
  email: string,
  fullName: string,
  password: string,
): Promise<ActionResult<null>> {
  if (!token || !email || !fullName || !password) {
    return { ok: false, error: "All fields are required", code: "validation" }
  }

  const supabase = await createAppServerClient()

  const { error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })

  if (signUpError) {
    const msg = signUpError.message.toLowerCase()
    if (msg.includes("already") || signUpError.code === "user_already_exists") {
      return { ok: false, error: "account_exists", code: "account_exists" }
    }
    console.error("[signUpAndAccept] signUp failed:", signUpError)
    return { ok: false, error: "server", code: "server" }
  }

  const { data: orgId, error: rpcError } = await supabase.rpc("accept_invitation", {
    p_token: token,
  })

  if (rpcError) {
    return { ok: false, error: rpcError.message, code: mapRpcError(rpcError.message) }
  }

  void setCurrentScope({ organisationId: orgId as string, branchId: null, role: "inventory" as Role })

  return { ok: true, data: null }
}

// Convenience re-export so the form can call signOut without a separate import.
export async function signOutForInviteAction(): Promise<void> {
  const supabase = await createAppServerClient()
  await supabase.auth.signOut()
  redirect("/login")
}
