"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import {
  planSchema,
  clientPlanSchema,
  type PlanInput,
  type ClientPlanInput,
} from "@/lib/validation/plans"
import {
  getPlans, getActivePlanSummaries, getClientPlans, getClientActivePlansForClient,
  type Plan, type PlanSummary, type ClientPlan, type ClientActivePlan,
} from "@/lib/db/queries/plans"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function getPlansAction(): Promise<Plan[]> {
  return getPlans()
}

export async function getActivePlanSummariesAction(): Promise<PlanSummary[]> {
  return getActivePlanSummaries()
}

export async function getClientPlansAction(): Promise<ClientPlan[]> {
  return getClientPlans()
}

export async function getClientActivePlansAction(clientId: string): Promise<ClientActivePlan[]> {
  return getClientActivePlansForClient(clientId)
}

export async function createPlanAction(
  input: PlanInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = planSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory", "admin", "sales")
  const supabase = await createAppServerClient()

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return { ok: false, error: "auth" }

  // Step 1: create plan header
  const { data: plan, error: planError } = await supabase
    .from("plans")
    .insert({
      organisation_id: scope.organisationId,
      name:        parsed.data.name.trim(),
      type:        parsed.data.type,
      price_cents: Math.round(parsed.data.priceNaira * 100),
      is_active:   true,
      created_by:  authData.user.id,
    })
    .select("id")
    .single()

  if (planError) {
    console.error("[createPlanAction] plan insert", planError)
    if (planError.code === "23505") {
      return { ok: false, error: "duplicate_name", message: "A plan with this name already exists." }
    }
    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  // Step 2: insert plan_lines
  const linesPayload = parsed.data.lines.map((l) => ({
    plan_id:         plan.id,
    service_type_id: l.serviceTypeId,
    session_count:   l.sessionCount,
  }))

  const { error: linesError } = await supabase.from("plan_lines").insert(linesPayload)

  if (linesError) {
    console.error("[createPlanAction] plan_lines insert", linesError)
    // Roll back: delete the plan (cascades plan_lines)
    await supabase.from("plans").update({ deleted_at: new Date().toISOString() }).eq("id", plan.id)
    return { ok: false, error: "server", message: "Could not save service lines. Please try again." }
  }

  return { ok: true, data: { id: plan.id } }
}

export async function updatePlanAction(id: string, input: PlanInput): Promise<ActionResult> {
  const parsed = planSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  await requireRole("owner", "inventory", "admin", "sales")
  const supabase = await createAppServerClient()

  // Step 1: update plan header
  const { error: planError } = await supabase
    .from("plans")
    .update({
      name:        parsed.data.name.trim(),
      type:        parsed.data.type,
      price_cents: Math.round(parsed.data.priceNaira * 100),
    })
    .eq("id", id)

  if (planError) {
    console.error("[updatePlanAction] plan update", planError)
    if (planError.code === "23505") {
      return { ok: false, error: "duplicate_name", message: "A plan with this name already exists." }
    }
    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  // Step 2: replace all plan_lines (delete + re-insert)
  const { error: deleteError } = await supabase.from("plan_lines").delete().eq("plan_id", id)

  if (deleteError) {
    console.error("[updatePlanAction] plan_lines delete", deleteError)
    return { ok: false, error: "server", message: "Could not update service lines. Please try again." }
  }

  const linesPayload = parsed.data.lines.map((l) => ({
    plan_id:         id,
    service_type_id: l.serviceTypeId,
    session_count:   l.sessionCount,
  }))

  const { error: linesError } = await supabase.from("plan_lines").insert(linesPayload)

  if (linesError) {
    console.error("[updatePlanAction] plan_lines insert", linesError)
    return { ok: false, error: "server", message: "Could not save service lines. Please try again." }
  }

  return { ok: true, data: null }
}

export async function togglePlanAction(id: string, isActive: boolean): Promise<ActionResult> {
  await requireRole("owner", "inventory", "admin", "sales")
  const supabase = await createAppServerClient()

  const { error } = await supabase.from("plans").update({ is_active: isActive }).eq("id", id)

  if (error) {
    console.error("[togglePlanAction]", error)
    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: null }
}

export async function createClientPlanAction(
  input: ClientPlanInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = clientPlanSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory", "admin", "sales")
  const supabase = await createAppServerClient()

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return { ok: false, error: "auth" }

  // Compute sessions_total server-side from the live plan_lines — never trust the form.
  const { data: linesData, error: linesError } = await supabase
    .from("plan_lines")
    .select("session_count")
    .eq("plan_id", parsed.data.planId)

  if (linesError) {
    return { ok: false, error: "server", message: "Could not load plan details. Please try again." }
  }

  const sessionsTotal = (linesData ?? []).reduce((sum, l) => sum + (l.session_count as number), 0)

  if (sessionsTotal === 0) {
    return {
      ok: false,
      error: "plan_no_sessions",
      message: "This plan has no sessions configured. Add service lines to the plan first.",
    }
  }

  const { data, error } = await supabase
    .from("client_plans")
    .insert({
      organisation_id:  scope.organisationId,
      client_id:        parsed.data.clientId,
      plan_id:          parsed.data.planId,
      sessions_total:   sessionsTotal,
      sessions_used:    0,
      price_paid_cents: Math.round(parsed.data.pricePaidNaira * 100),
      purchased_on:     parsed.data.purchasedOn,
      created_by:       authData.user.id,
    })
    .select("id")
    .single()

  if (error) {
    console.error("[createClientPlanAction]", error)
    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { id: data.id } }
}
