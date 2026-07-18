"use server"

import { getCurrentScope, setCurrentScope } from "@/lib/auth/scope"

type OrgActionResult = { ok: boolean; error?: string }

export async function enterBranchAction(branchId: string): Promise<OrgActionResult> {
  if (!branchId) return { ok: false, error: "Branch ID required" }

  const scope = await getCurrentScope()
  if (!scope || scope.role !== "owner") return { ok: false, error: "Not authorised" }

  const ok = await setCurrentScope({
    organisationId: scope.organisationId,
    branchId,
    role: "owner",
  })
  return { ok }
}

export async function clearBranchAction(): Promise<OrgActionResult> {
  const scope = await getCurrentScope()
  if (!scope) return { ok: false, error: "Not authenticated" }

  const ok = await setCurrentScope({
    organisationId: scope.organisationId,
    branchId: null,
    role: "owner",
  })
  return { ok }
}
