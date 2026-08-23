"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireScope, requireRole } from "@/lib/auth/guards"
import { serviceTypeSchema, serviceUsageSchema, serviceSessionSchema } from "@/lib/validation/services"
import type { ServiceTypeInput, ServiceUsageInput, ServiceSessionInput } from "@/lib/validation/services"
import {
  getActiveServiceTypes,
  getServiceRecordById,
  getMyJobCostingSessions,
} from "@/lib/db/queries/services"
import type { ServiceType, ServiceRecordDetail, JobCostingSessionRow } from "@/lib/db/queries/services"

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

  const scope = await requireRole("owner", "inventory", "admin", "sales")
  const supabase = await createAppServerClient()

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return { ok: false, error: "auth" }

  const { data, error } = await supabase
    .from("service_types")
    .insert({
      organisation_id: scope.organisationId,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      default_price_cents: Math.round(parsed.data.defaultPriceNaira * 100),
      is_active: parsed.data.isActive,
      created_by: authData.user.id,
    })
    .select("id")
    .single()

  if (error) {
    console.error("[createServiceTypeAction]", error)
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

  await requireRole("owner", "inventory", "admin", "sales")
  const supabase = await createAppServerClient()

  const { error } = await supabase
    .from("service_types")
    .update({
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      default_price_cents: Math.round(parsed.data.defaultPriceNaira * 100),
      is_active: parsed.data.isActive,
    })
    .eq("id", id)

  if (error) {
    console.error("[updateServiceTypeAction]", error)
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
    p_member_id: parsed.data.memberId || null,
    p_client_email: parsed.data.clientEmail || null,
    p_client_id: parsed.data.clientId || null,
    p_client_plan_id: parsed.data.clientPlanId || null,
  })

  if (error) {
    const msg: string = error.message ?? ""
    const lower = msg.toLowerCase()
    console.error("[recordServiceUsageAction] RPC error:", msg)

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
    if (lower.includes("plan exhausted"))
      return {
        ok: false,
        error: "plan_exhausted",
        message: "This subscription has no sessions remaining.",
      }
    if (lower.includes("client plan not found"))
      return {
        ok: false,
        error: "plan_not_found",
        message: "The selected subscription could not be found. Please refresh and try again.",
      }
    if (lower.includes("cost_layers exhausted") || lower.includes("out of sync"))
      return {
        ok: false,
        error: "cost_sync",
        message: "This item's stock and cost records are out of sync. Please contact support.",
      }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { recordId: data as string } }
}

export async function createServiceSessionAction(
  input: ServiceSessionInput,
): Promise<ActionResult<{ recordId: string }>> {
  const parsed = serviceSessionSchema.safeParse(input)
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("create_service_session", {
    p_branch_id:         branchId,
    p_service_type_id:   parsed.data.serviceTypeId,
    p_customer_name:     parsed.data.customerName || null,
    p_customer_phone:    parsed.data.customerPhone || null,
    p_performed_on:      parsed.data.performedOn,
    p_service_fee_cents: serviceFeeCents,
    p_note:              parsed.data.note || null,
    p_member_id:         parsed.data.memberId || null,
    p_client_email:      parsed.data.clientEmail || null,
    p_client_id:         parsed.data.clientId || null,
    p_client_plan_id:    parsed.data.clientPlanId || null,
  })

  if (error) {
    const msg: string = error.message ?? ""
    const lower = msg.toLowerCase()
    console.error("[createServiceSessionAction] RPC error:", msg)

    if (lower.includes("service type not found or inactive"))
      return { ok: false, error: "invalid_service", message: "This service type is no longer available." }
    if (lower.includes("not authorised"))
      return { ok: false, error: "not_allowed", message: "You are not authorised to record service usage in this branch." }
    if (lower.includes("plan exhausted"))
      return { ok: false, error: "plan_exhausted", message: "This subscription has no sessions remaining." }
    if (lower.includes("client plan not found"))
      return { ok: false, error: "plan_not_found", message: "The selected subscription could not be found. Please refresh and try again." }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { recordId: data as string } }
}

export async function addServiceConsumptionAction(
  recordId: string,
  lines: { productId: string; quantity: number }[],
): Promise<ActionResult<null>> {
  if (!lines || lines.length === 0)
    return { ok: false, error: "validation", message: "Add at least one product used." }
  for (const l of lines) {
    if (!l.productId)
      return { ok: false, error: "validation", message: "Select a product for each row." }
    if (!Number.isInteger(l.quantity) || l.quantity <= 0)
      return { ok: false, error: "validation", message: "Quantity must be at least 1." }
  }

  await requireScope()
  const supabase = await createAppServerClient()

  const pLines = lines.map((l) => ({ product_id: l.productId, quantity: l.quantity }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("add_service_consumption", {
    p_service_record_id: recordId,
    p_lines: pLines,
  })

  if (error) {
    const msg: string = error.message ?? ""
    const lower = msg.toLowerCase()
    console.error("[addServiceConsumptionAction] RPC error:", msg)

    if (lower.includes("not authorised to add consumption"))
      return {
        ok: false,
        error: "not_allowed",
        message: "Only the practitioner who performed this session can add items used.",
      }
    if (lower.includes("service record not found"))
      return {
        ok: false,
        error: "not_found",
        message: "Session not found. Please refresh and try again.",
      }
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
            message: `Not enough ${product.name} (${product.sku}) — holding ${fmt(held)}, consuming ${fmt(using)}.`,
          }
        }
      }
      return {
        ok: false,
        error: "insufficient_holding",
        message: "Insufficient holding for one of the products.",
      }
    }
    if (lower.includes("cost_layers exhausted") || lower.includes("out of sync"))
      return {
        ok: false,
        error: "cost_sync",
        message: "Stock and cost records are out of sync. Please contact support.",
      }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: null }
}

export async function addServiceItemConsumptionAction(
  recordId: string,
  lines: { serviceItemId: string; amountUsed?: number | null }[],
): Promise<ActionResult<null>> {
  if (!lines || lines.length === 0)
    return { ok: false, error: "validation", message: "Add at least one service item." }

  await requireScope()
  const supabase = await createAppServerClient()

  const pLines = lines.map((l) => ({
    service_item_id: l.serviceItemId,
    amount_used: l.amountUsed ?? null,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("add_service_item_consumption", {
    p_service_record_id: recordId,
    p_lines: pLines,
  })

  if (error) {
    const msg: string = error.message ?? ""
    const lower = msg.toLowerCase()
    console.error("[addServiceItemConsumptionAction] RPC error:", msg)

    if (lower.includes("not authorised"))
      return { ok: false, error: "not_allowed", message: "Only the practitioner who performed this session can add items." }
    if (lower.includes("service record not found"))
      return { ok: false, error: "not_found", message: "Session not found. Please refresh and try again." }
    if (lower.includes("not found in this organisation"))
      return { ok: false, error: "not_found", message: "One or more service items could not be found." }
    if (lower.includes("is inactive"))
      return { ok: false, error: "inactive", message: "One or more service items are inactive." }
    if (lower.includes("amount_used must be positive"))
      return { ok: false, error: "validation", message: "Enter a valid amount for each consumable item." }

    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: null }
}

export async function toggleServiceTypeAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireRole("owner", "inventory", "admin", "sales")
  const supabase = await createAppServerClient()

  const { error } = await supabase
    .from("service_types")
    .update({ is_active: isActive })
    .eq("id", id)

  if (error) {
    console.error("[toggleServiceTypeAction]", error)
    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: null }
}

export async function getServiceRecordDetailAction(
  id: string,
): Promise<ServiceRecordDetail | null> {
  await requireScope()
  return getServiceRecordById(id)
}

export async function getMyJobCostingSessionsAction(): Promise<JobCostingSessionRow[]> {
  await requireScope()
  return getMyJobCostingSessions()
}
