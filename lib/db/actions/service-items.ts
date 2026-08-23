"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import { measurementSchema, serviceItemSchema } from "@/lib/validation/service-items"
import type { MeasurementInput, ServiceItemInput } from "@/lib/validation/service-items"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function createMeasurementAction(
  input: MeasurementInput,
): Promise<ActionResult<{ id: string; name: string; symbol: string | null }>> {
  const parsed = measurementSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory", "admin", "sales")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any
  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return { ok: false, error: "auth" }

  // Prevent duplicating a system measurement name.
  const { count: systemCount } = await supabase
    .from("measurements")
    .select("id", { count: "exact", head: true })
    .is("organisation_id", null)
    .ilike("name", parsed.data.name.trim())

  if ((systemCount ?? 0) > 0) {
    return {
      ok: false,
      error: "system_name",
      message: `"${parsed.data.name}" is already a system measurement. Use it from the list.`,
    }
  }

  const name   = parsed.data.name.trim()
  const symbol = parsed.data.symbol?.trim() || null

  const { data, error } = await supabase
    .from("measurements")
    .insert({
      organisation_id: scope.organisationId,
      name,
      symbol,
      is_system:  false,
      created_by: authData.user.id,
    })
    .select("id, name, symbol")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "duplicate_name", message: "A measurement with this name already exists." }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true, data: { id: data.id, name: data.name, symbol: data.symbol } }
}

export async function createServiceItemAction(
  input: ServiceItemInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = serviceItemSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory", "admin", "sales")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any
  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return { ok: false, error: "auth" }

  const { data, error } = await supabase
    .from("service_items")
    .insert({
      organisation_id: scope.organisationId,
      name:            parsed.data.name.trim(),
      category:        parsed.data.category,
      measurement_id:  parsed.data.measurementId || null,
      package_size:    parsed.data.packageSize    ?? null,
      amount_cents:    Math.round(parsed.data.amountNaira * 100),
      product_id:      parsed.data.productId      || null,
      is_active:       parsed.data.isActive ?? true,
      created_by:      authData.user.id,
    })
    .select("id")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "duplicate_name", message: "A service item with this name already exists." }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true, data: { id: data.id } }
}

export async function updateServiceItemAction(
  id: string,
  input: ServiceItemInput,
): Promise<ActionResult> {
  const parsed = serviceItemSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory", "admin", "sales")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const { error } = await supabase
    .from("service_items")
    .update({
      name:           parsed.data.name.trim(),
      category:       parsed.data.category,
      measurement_id: parsed.data.measurementId || null,
      package_size:   parsed.data.packageSize    ?? null,
      amount_cents:   Math.round(parsed.data.amountNaira * 100),
      product_id:     parsed.data.productId      || null,
      is_active:      parsed.data.isActive ?? true,
    })
    .eq("id", id)
    .eq("organisation_id", scope.organisationId)

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "duplicate_name", message: "A service item with this name already exists." }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true, data: null }
}

export async function toggleServiceItemAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  const scope = await requireRole("owner", "inventory", "admin", "sales")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const { error } = await supabase
    .from("service_items")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("organisation_id", scope.organisationId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, data: null }
}
