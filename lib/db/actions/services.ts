"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireScope, requireRole } from "@/lib/auth/guards"
import { serviceTypeSchema, serviceUsageSchema } from "@/lib/validation/services"
import type { ServiceTypeInput, ServiceUsageInput } from "@/lib/validation/services"
import {
  getActiveServiceTypes,
  getServiceRecordById,
} from "@/lib/db/queries/services"
import type { ServiceType, ServiceRecordDetail } from "@/lib/db/queries/services"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function getActiveServiceTypesAction(): Promise<ServiceType[]> {
  return getActiveServiceTypes()
}

export async function createServiceTypeAction(
  input: ServiceTypeInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = serviceTypeSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const scope = await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return { ok: false, error: "auth" }

  const { data, error } = await supabase
    .from("service_types")
    .insert({
      organisation_id: scope.organisationId,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      is_active: parsed.data.isActive,
      created_by: authData.user.id,
    })
    .select("id")
    .single()

  if (error) {
    if (error.message?.includes("unique") || error.code === "23505") {
      return {
        ok: false,
        error: "duplicate_name",
        message: "A service type with this name already exists.",
      }
    }
    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { id: data.id } }
}

export async function updateServiceTypeAction(
  id: string,
  input: ServiceTypeInput,
): Promise<ActionResult> {
  const parsed = serviceTypeSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const { error } = await supabase
    .from("service_types")
    .update({
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      is_active: parsed.data.isActive,
    })
    .eq("id", id)

  if (error) {
    if (error.message?.includes("unique") || error.code === "23505") {
      return {
        ok: false,
        error: "duplicate_name",
        message: "A service type with this name already exists.",
      }
    }
    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: null }
}

export async function recordServiceUsageAction(
  input: ServiceUsageInput,
): Promise<ActionResult<{ recordId: string }>> {
  const parsed = serviceUsageSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation",
      message: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  }

  const scope = await requireScope()
  const supabase = await createAppServerClient()

  let branchId = scope.branchId ?? ""
  if (!branchId) {
    const { data: branches } = await supabase
      .from("branches")
      .select("id")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)
    if (!branches || branches.length === 0) {
      return { ok: false, error: "server", message: "No branches found in this organisation." }
    }
    if (branches.length > 1) {
      return {
        ok: false,
        error: "branch_required",
        message: "Select a branch before recording service usage.",
      }
    }
    branchId = branches[0].id
  }

  const serviceFeeCents =
    parsed.data.serviceFeeNaira != null
      ? Math.round(parsed.data.serviceFeeNaira * 100)
      : null

  const pLines = parsed.data.lines.map((l) => ({
    product_id: l.productId,
    quantity: l.quantity,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("record_service_usage", {
    p_branch_id: branchId,
    p_service_type_id: parsed.data.serviceTypeId,
    p_customer_name: parsed.data.customerName || null,
    p_customer_phone: parsed.data.customerPhone || null,
    p_performed_on: parsed.data.performedOn,
    p_service_fee_cents: serviceFeeCents,
    p_note: parsed.data.note || null,
    p_lines: pLines,
  })

  if (error) {
    const msg: string = error.message ?? ""
    const lower = msg.toLowerCase()

    if (lower.includes("insufficient holding")) {
      const productMatch = msg.match(/insufficient holding for product ([0-9a-f-]{36})/i)
      const numbersMatch = msg.match(/\(holding: (\d+), consuming: (\d+)\)/i)

      if (productMatch) {
        const productId = productMatch[1]
        const { data: product } = await supabase
          .from("products")
          .select("name, sku")
          .eq("id", productId)
          .single()

        if (product) {
          const held = numbersMatch ? parseInt(numbersMatch[1], 10) : 0
          const using = numbersMatch ? parseInt(numbersMatch[2], 10) : 0
          const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n)
          return {
            ok: false,
            error: "insufficient_holding",
            message: `You don't have enough ${product.name} (${product.sku}) — holding ${fmt(held)}, using ${fmt(using)}.`,
          }
        }
      }
      return {
        ok: false,
        error: "insufficient_holding",
        message: "You don't have enough stock in your holding for this service.",
      }
    }

    if (lower.includes("service type not found or inactive"))
      return {
        ok: false,
        error: "invalid_service",
        message: "This service type is no longer available.",
      }
    if (lower.includes("not authorised"))
      return {
        ok: false,
        error: "not_allowed",
        message: "You are not authorised to record service usage in this branch.",
      }
    if (lower.includes("at least one product"))
      return {
        ok: false,
        error: "validation",
        message: "Add at least one product used in this service.",
      }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { recordId: data as string } }
}

export async function getServiceRecordDetailAction(
  id: string,
): Promise<ServiceRecordDetail | null> {
  await requireScope()
  return getServiceRecordById(id)
}
