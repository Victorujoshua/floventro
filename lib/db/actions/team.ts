"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireOwner } from "@/lib/auth/guards"
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

  const scope = await requireOwner()
  const supabase = await createAppServerClient()

  // Resolve branchId
  let branchId: string | null = parsed.data.branchId ?? null

  if (!branchId) {
    const { data: branches } = await supabase
      .from("branches")
      .select("id")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)

    if (branches && branches.length === 1) {
      branchId = branches[0].id
    } else if (branches && branches.length > 1) {
      return { ok: false, error: "branch_required" }
    }
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

  // Get inviter name + org name for the email
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
  const scope = await requireOwner()
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
