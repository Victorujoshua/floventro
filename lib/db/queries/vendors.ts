import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export async function getVendors() {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("vendors")
    .select(
      "id, organisation_id, branch_id, name, contact_person, phone, email, tin, cac_registration, notes, created_at, updated_at, vendor_invoices(total_cents, amount_paid_cents, status, deleted_at)",
    )
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error) return []

  type InvoiceRow = { total_cents: number; amount_paid_cents: number; status: string; deleted_at: string | null }

  return data.map(({ vendor_invoices, ...v }) => ({
    ...v,
    outstanding_cents: (vendor_invoices as InvoiceRow[] ?? [])
      .filter((inv) => inv.deleted_at === null && inv.status !== "paid")
      .reduce((sum, inv) => sum + inv.total_cents - inv.amount_paid_cents, 0),
  }))
}

export async function getOrgBranches() {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("branches")
    .select("id, name")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error) return []
  return data
}
