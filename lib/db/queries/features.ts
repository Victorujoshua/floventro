import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"

// Returns feature names hidden for a given (branch, role).
// Fails open on error — treats all features as visible when the table is
// unreachable (e.g. before app_0052 is applied).
export async function getHiddenFeatures(
  branchId: string | null,
  role: string,
): Promise<string[]> {
  if (!branchId) return []
  try {
    const supabase = await createAppServerClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("feature_visibility")
      .select("feature")
      .eq("branch_id", branchId)
      .eq("role", role)
    return ((data ?? []) as { feature: string }[]).map((r) => r.feature)
  } catch {
    return []
  }
}

// Returns all hidden (feature, role) pairs for a branch.
// Used by the settings page to render toggle state.
export async function getFeatureVisibilityForBranch(
  branchId: string,
): Promise<Array<{ feature: string; role: string }>> {
  try {
    const supabase = await createAppServerClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("feature_visibility")
      .select("feature, role")
      .eq("branch_id", branchId)
    return (data ?? []) as Array<{ feature: string; role: string }>
  } catch {
    return []
  }
}
