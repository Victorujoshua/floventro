"use server"

import { setCurrentScope, type Role } from "@/lib/auth/scope"

export async function setScopeAction(
  organisationId: string,
  branchId: string | null,
  role: string,
): Promise<boolean> {
  return setCurrentScope({ organisationId, branchId, role: role as Role })
}
