"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireOwner } from "@/lib/auth/guards"
import { branchSchema } from "@/lib/validation/branches"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function createBranchAction(
  name: string,
): Promise<ActionResult<{ branchId: string }>> {
  const parsed = branchSchema.safeParse({ name })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" }
  }

  const scope = await requireOwner()
  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("branches")
    .insert({ organisation_id: scope.organisationId, name: parsed.data.name.trim() })
    .select("id")
    .single()

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "duplicate_name",
        message: `A branch named "${parsed.data.name.trim()}" already exists in your organisation.`,
      }
    }
    return { ok: false, error: "server", message: "Failed to create branch. Please try again." }
  }

  return { ok: true, data: { branchId: data.id } }
}

export async function renameBranchAction(
  branchId: string,
  name: string,
): Promise<ActionResult> {
  const parsed = branchSchema.safeParse({ name })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name" }
  }

  const scope = await requireOwner()
  const supabase = await createAppServerClient()

  const { error } = await supabase
    .from("branches")
    .update({ name: parsed.data.name.trim() })
    .eq("id", branchId)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "duplicate_name",
        message: `A branch named "${parsed.data.name.trim()}" already exists in your organisation.`,
      }
    }
    return { ok: false, error: "server", message: "Failed to rename branch. Please try again." }
  }

  return { ok: true, data: null }
}
