"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import { vendorSchema, type VendorInput } from "@/lib/validation/vendors"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string }

export async function createVendorAction(
  input: VendorInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = vendorSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("vendors")
    .insert({
      organisation_id: scope.organisationId,
      branch_id: parsed.data.branchId,
      name: parsed.data.name,
      contact_person: parsed.data.contactPerson || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      tin: parsed.data.tin || null,
      cac_registration: parsed.data.cacRegistration || null,
      notes: parsed.data.notes || null,
    })
    .select("id")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "name_taken", code: "name_taken" }
    }
    if (error.code === "42501") {
      return { ok: false, error: "not_allowed", code: "not_allowed" }
    }
    return { ok: false, error: error.message }
  }

  return { ok: true, data: { id: data.id } }
}

export async function updateVendorAction(
  id: string,
  input: VendorInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = vendorSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("vendors")
    .update({
      name: parsed.data.name,
      contact_person: parsed.data.contactPerson || null,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      tin: parsed.data.tin || null,
      cac_registration: parsed.data.cacRegistration || null,
      notes: parsed.data.notes || null,
    })
    .eq("id", id)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .select("id")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "name_taken", code: "name_taken" }
    }
    if (error.code === "42501") {
      return { ok: false, error: "not_allowed", code: "not_allowed" }
    }
    return { ok: false, error: error.message }
  }
  if (!data) return { ok: false, error: "Vendor not found" }

  return { ok: true, data: { id: data.id } }
}

export async function deleteVendorAction(id: string): Promise<ActionResult> {
  const scope = await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const { error } = await supabase
    .from("vendors")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)

  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "not_allowed", code: "not_allowed" }
    }
    return { ok: false, error: error.message }
  }

  return { ok: true, data: null }
}
