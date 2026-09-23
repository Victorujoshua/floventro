"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import { inviteSchema, type InviteInput } from "@/lib/validation/invites"
import { sendInviteEmail } from "@/lib/email/zeptomail"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export async function inviteMemberAction(
  input: InviteInput,
): Promise<ActionResult<{ acceptUrl: string; emailSent: boolean; emailError?: string }>> {
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "admin")

  // Escalation guard: mirrors the RLS WITH CHECK for the admin path.
  // Admins cannot invite other admins — only owners can assign the admin role.
  if (scope.role === "admin" && parsed.data.role === "admin") {
    return { ok: false, error: "Admins cannot invite other admins." }
  }

  const supabase = await createAppServerClient()

  // Branch always comes from the current entered branch — never from the form.
  const branchId = scope.branchId
  if (!branchId) {
    return { ok: false, error: "Enter a branch before inviting a team member." }
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: invite, error } = await supabase
    .from("invitations")
    .insert({
      organisation_id: scope.organisationId,
      branch_id: branchId,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      invited_by: scope.userId,
      expires_at: expiresAt,
    })
    .select("token")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "already_invited" }
    }
    return { ok: false, error: error.message }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.floventro.com"
  const acceptUrl = `${appUrl}/accept-invite/${(invite as { token: string }).token}`

  const { data: { user } } = await supabase.auth.getUser()
  const inviterName =
    (user?.user_metadata?.full_name as string) || user?.email || "Your team"

  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", scope.organisationId)
    .maybeSingle()

  console.log("[team] about to call sendInviteEmail", {
    email: parsed.data.email.toLowerCase(),
    inviterName,
    organisationName: org?.name ?? "your organisation",
    role: parsed.data.role,
    acceptUrl,
  })

  const emailResult = await sendInviteEmail({
    email: parsed.data.email.toLowerCase(),
    inviterName,
    organisationName: org?.name ?? "your organisation",
    role: parsed.data.role,
    acceptUrl,
  })

  console.log("[team] sendInviteEmail result:", emailResult)

  let emailError: string | undefined
  if (!emailResult.ok) emailError = emailResult.error

  return {
    ok: true,
    data: { acceptUrl, emailSent: emailResult.ok, emailError },
  }
}

export async function resendInviteAction(inviteId: string): Promise<ActionResult<null>> {
  const scope = await requireRole("owner", "admin")
  const supabase = await createAppServerClient()

  const { data: invite, error } = await supabase
    .from("invitations")
    .select("email, role, token")
    .eq("id", inviteId)
    .eq("organisation_id", scope.organisationId)
    .eq("status", "pending")
    .maybeSingle()

  if (error || !invite) {
    return { ok: false, error: "Invite not found or already used." }
  }

  const row = invite as { email: string; role: string; token: string }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.floventro.com"
  const acceptUrl = `${appUrl}/accept-invite/${row.token}`

  const { data: { user } } = await supabase.auth.getUser()
  const inviterName = (user?.user_metadata?.full_name as string) || user?.email || "Your team"

  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", scope.organisationId)
    .maybeSingle()

  const emailResult = await sendInviteEmail({
    email: row.email,
    inviterName,
    organisationName: org?.name ?? "your organisation",
    role: row.role,
    acceptUrl,
  })

  if (!emailResult.ok) {
    return { ok: false, error: "Email could not be sent — check ZEPTOMAIL_TOKEN and ZEPTOMAIL_FROM." }
  }

  return { ok: true, data: null }
}

export async function revokeInviteAction(inviteId: string): Promise<ActionResult> {
  const scope = await requireRole("owner", "admin")
  const supabase = await createAppServerClient()

  const { error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("organisation_id", scope.organisationId)
    .eq("status", "pending")

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: null }
}

// ── Active members ────────────────────────────────────────────────────────────
// Guards (owner-only, no self-edit, no owner rows, last owner, held stock,
// role collision) are enforced in update_membership_role / remove_membership
// (app_0071). Their messages are user-facing and passed through as-is.

const EDITABLE_ROLES = ["inventory", "sales", "internal_use", "admin"] as const

function membershipError(error: { code?: string; message?: string }, context: string): string {
  if (error.code === "P0001" && error.message) {
    return error.message.charAt(0).toUpperCase() + error.message.slice(1)
  }
  console.error(`[team] ${context}`, error)
  return "Something went wrong — please try again."
}

export async function updateMemberRoleAction(
  membershipId: string,
  role: string,
): Promise<ActionResult> {
  await requireRole("owner")

  if (!(EDITABLE_ROLES as readonly string[]).includes(role)) {
    return { ok: false, error: "Role must be Inventory, Sales, Internal Use or Branch Admin." }
  }

  const supabase = await createAppServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("update_membership_role", {
    p_membership_id: membershipId,
    p_role: role,
  })

  if (error) return { ok: false, error: membershipError(error, "update_membership_role") }
  return { ok: true, data: null }
}

export async function removeMemberAction(membershipId: string): Promise<ActionResult> {
  await requireRole("owner")
  const supabase = await createAppServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("remove_membership", {
    p_membership_id: membershipId,
  })

  if (error) return { ok: false, error: membershipError(error, "remove_membership") }
  return { ok: true, data: null }
}
