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
): Promise<ActionResult<{ acceptUrl: string; emailSent: boolean }>> {
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

  const emailResult = await sendInviteEmail({
    email: parsed.data.email.toLowerCase(),
    inviterName,
    organisationName: org?.name ?? "your organisation",
    role: parsed.data.role,
    acceptUrl,
  })

  return {
    ok: true,
    data: { acceptUrl, emailSent: emailResult.ok },
  }
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
