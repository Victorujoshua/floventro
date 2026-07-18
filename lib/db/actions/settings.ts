"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireOwner } from "@/lib/auth/guards"
import { payoutAccountSchema, type PayoutAccountInput } from "@/lib/validation/settings"

type ActionResult = { ok: true } | { ok: false; error: string }

export async function updateOrgPayoutAccountAction(input: PayoutAccountInput): Promise<ActionResult> {
  const parsed = payoutAccountSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const scope = await requireOwner()
  const supabase = await createAppServerClient()

  const patch = {
    payout_account_name:   parsed.data.accountName   || null,
    payout_account_number: parsed.data.accountNumber || null,
    payout_bank_name:      parsed.data.bankName      || null,
  }

  const { error } = await supabase
    .from("organisations")
    .update(patch as Record<string, string | null>)
    .eq("id", scope.organisationId)

  if (error) return { ok: false, error: "Failed to save. Please try again." }
  return { ok: true }
}

export async function updateBranchPayoutAccountAction(
  branchId: string,
  input: PayoutAccountInput,
): Promise<ActionResult> {
  const parsed = payoutAccountSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const scope = await requireOwner()
  const supabase = await createAppServerClient()

  const patch = {
    payout_account_name:   parsed.data.accountName   || null,
    payout_account_number: parsed.data.accountNumber || null,
    payout_bank_name:      parsed.data.bankName      || null,
  }

  const { error } = await supabase
    .from("branches")
    .update(patch as Record<string, string | null>)
    .eq("id", branchId)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)

  if (error) return { ok: false, error: "Failed to save. Please try again." }
  return { ok: true }
}
