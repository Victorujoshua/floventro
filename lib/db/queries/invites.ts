import "server-only"
import { createAppServiceRoleClient } from "@/lib/supabase/app-server"

export type InviteStatus = "valid" | "not_found" | "used" | "expired"

export type InvitePreview = {
  status: InviteStatus
  email: string
  role: string
  orgName: string
  branchName: string | null
}

/**
 * Server-only lookup via service-role client (bypasses RLS).
 * Returns only display-safe fields — never the token or other rows.
 */
export async function getInviteByToken(token: string): Promise<InvitePreview> {
  const admin = createAppServiceRoleClient()

  const { data, error } = await admin
    .from("invitations")
    .select(
      "email, role, status, expires_at, organisations(name), branches(name)",
    )
    .eq("token", token)
    .maybeSingle()

  if (error || !data) return { status: "not_found", email: "", role: "", orgName: "", branchName: null }

  const row = data as {
    email: string
    role: string
    status: string
    expires_at: string
    organisations: unknown
    branches: unknown
  }

  if (row.status !== "pending") {
    return { status: "used", email: row.email, role: row.role, orgName: resolveName(row.organisations), branchName: resolveName(row.branches) }
  }

  if (new Date(row.expires_at) < new Date()) {
    return { status: "expired", email: row.email, role: row.role, orgName: resolveName(row.organisations), branchName: resolveName(row.branches) }
  }

  return {
    status: "valid",
    email: row.email,
    role: row.role,
    orgName: resolveName(row.organisations),
    branchName: resolveName(row.branches),
  }
}

function resolveName(raw: unknown): string {
  if (!raw) return ""
  if (Array.isArray(raw)) return (raw[0] as { name?: string })?.name ?? ""
  return (raw as { name?: string }).name ?? ""
}
