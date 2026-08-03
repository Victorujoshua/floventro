"use server"

import { requireRole } from "@/lib/auth/guards"
import { createAppServerClient } from "@/lib/supabase/app-server"

type ActionResult = { ok: true } | { ok: false; error: string }

const VALID_FEATURES = ["fulfilment"] as const
type ValidFeature = (typeof VALID_FEATURES)[number]

const TOGGLEABLE_ROLES = ["sales", "inventory", "internal_use"] as const
type ToggleableRole = (typeof TOGGLEABLE_ROLES)[number]

export async function setFeatureVisibilityAction(
  feature: string,
  role: string,
  hidden: boolean,
): Promise<ActionResult> {
  if (!VALID_FEATURES.includes(feature as ValidFeature)) {
    return { ok: false, error: "Invalid feature." }
  }
  if (!TOGGLEABLE_ROLES.includes(role as ToggleableRole)) {
    return { ok: false, error: "This role cannot be configured." }
  }

  const scope = await requireRole("owner", "admin")
  if (!scope.branchId) {
    return { ok: false, error: "No branch selected. Enter a branch to configure visibility." }
  }

  const supabase = await createAppServerClient()

  if (hidden) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("feature_visibility")
      .upsert(
        {
          branch_id: scope.branchId,
          feature,
          role,
          hidden_by: scope.userId,
          hidden_at: new Date().toISOString(),
        },
        { onConflict: "branch_id,feature,role" },
      )
    if (error) return { ok: false, error: "Failed to update visibility. Please try again." }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("feature_visibility")
      .delete()
      .eq("branch_id", scope.branchId)
      .eq("feature", feature)
      .eq("role", role)
    if (error) return { ok: false, error: "Failed to update visibility. Please try again." }
  }

  return { ok: true }
}
