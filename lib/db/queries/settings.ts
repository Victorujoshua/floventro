import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export type PayoutAccount = {
  accountName:   string | null
  accountNumber: string | null
  bankName:      string | null
}

export type BranchWithPayout = {
  id:     string
  name:   string
  payout: PayoutAccount
}

type RawPayout = {
  payout_account_name:   string | null
  payout_account_number: string | null
  payout_bank_name:      string | null
}

function toPayout(raw: RawPayout): PayoutAccount {
  return {
    accountName:   raw.payout_account_name,
    accountNumber: raw.payout_account_number,
    bankName:      raw.payout_bank_name,
  }
}

export async function getOrgPayoutAccount(): Promise<PayoutAccount | null> {
  const scope = await getCurrentScope()
  if (!scope) return null
  const supabase = await createAppServerClient()
  const { data, error } = await supabase
    .from("organisations")
    .select("payout_account_name, payout_account_number, payout_bank_name")
    .eq("id", scope.organisationId)
    .single()
  if (error || !data) return null
  return toPayout(data as unknown as RawPayout)
}

export async function getBranchesWithPayout(): Promise<BranchWithPayout[]> {
  const scope = await getCurrentScope()
  if (!scope) return []
  const supabase = await createAppServerClient()
  const { data, error } = await supabase
    .from("branches")
    .select("id, name, payout_account_name, payout_account_number, payout_bank_name")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
  if (error || !data) return []
  return (data as unknown as Array<{ id: string; name: string } & RawPayout>).map((b) => ({
    id:     b.id,
    name:   b.name,
    payout: toPayout(b),
  }))
}

// Returns the resolved payout for a branch: branch override if any field set, else org default.
// Used by the invoice renderer to know where to direct payment.
export async function getEffectivePayoutAccount(branchId: string): Promise<PayoutAccount | null> {
  const scope = await getCurrentScope()
  if (!scope) return null
  const supabase = await createAppServerClient()

  const [{ data: branch }, { data: org }] = await Promise.all([
    supabase
      .from("branches")
      .select("payout_account_name, payout_account_number, payout_bank_name")
      .eq("id", branchId)
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("organisations")
      .select("payout_account_name, payout_account_number, payout_bank_name")
      .eq("id", scope.organisationId)
      .single(),
  ])

  const b = branch as unknown as RawPayout | null
  const o = org as unknown as RawPayout | null

  if (b && (b.payout_account_name || b.payout_account_number || b.payout_bank_name)) {
    return toPayout(b)
  }
  if (!o) return null
  return toPayout(o)
}
