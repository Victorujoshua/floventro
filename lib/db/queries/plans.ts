import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

// ── Public types ──────────────────────────────────────────────────────────────

export type PlanLine = {
  id:              string
  serviceTypeId:   string
  serviceTypeName: string
  sessionCount:    number
}

export type Plan = {
  id:            string
  name:          string
  type:          "single" | "package"
  priceCents:    number
  isActive:      boolean
  createdAt:     string
  lines:         PlanLine[]
  totalSessions: number
}

export type ClientPlan = {
  id:              string
  clientId:        string
  clientName:      string
  clientMemberId:  string | null
  planId:          string | null
  planName:        string | null
  sessionsTotal:   number
  sessionsUsed:    number
  sessionsRemaining: number
  pricePaidCents:  number
  purchasedOn:     string
  createdAt:       string
}

// A minimal plan shape with total sessions, used in the subscription form.
export type PlanSummary = {
  id:            string
  name:          string
  priceCents:    number
  isActive:      boolean
  totalSessions: number
}

// Active subscriptions for a specific client — used in the record-service form.
export type ClientActivePlan = {
  id:               string
  planName:         string | null
  sessionsUsed:     number
  sessionsTotal:    number
  sessionsRemaining: number
}

// ── Raw shapes returned by PostgREST ─────────────────────────────────────────

type RawPlanLine = {
  id:              string
  service_type_id: string
  session_count:   number
  service_types:   { name: string } | { name: string }[] | null
}

type RawPlan = {
  id:              string
  name:            string
  type:            string
  price_cents:     number
  is_active:       boolean
  created_at:      string
  plan_lines:      RawPlanLine[]
}

type RawClientPlan = {
  id:               string
  client_id:        string
  plan_id:          string | null
  sessions_total:   number
  sessions_used:    number
  price_paid_cents: number
  purchased_on:     string
  created_at:       string
  clients:  { name: string; member_id: string | null } | { name: string; member_id: string | null }[] | null
  plans:    { name: string } | { name: string }[] | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveServiceTypeName(raw: RawPlanLine["service_types"]): string {
  if (!raw) return "Unknown service"
  if (Array.isArray(raw)) return raw[0]?.name ?? "Unknown service"
  return raw.name
}

function resolveClient(raw: RawClientPlan["clients"]) {
  if (!raw) return { name: "Unknown client", member_id: null }
  if (Array.isArray(raw)) return raw[0] ?? { name: "Unknown client", member_id: null }
  return raw
}

function resolvePlan(raw: RawClientPlan["plans"]): string | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0]?.name ?? null
  return raw.name
}

function mapPlan(row: RawPlan): Plan {
  const lines: PlanLine[] = row.plan_lines.map((l) => ({
    id:              l.id,
    serviceTypeId:   l.service_type_id,
    serviceTypeName: resolveServiceTypeName(l.service_types),
    sessionCount:    l.session_count,
  }))
  return {
    id:            row.id,
    name:          row.name,
    type:          row.type as "single" | "package",
    priceCents:    row.price_cents,
    isActive:      row.is_active,
    createdAt:     row.created_at,
    lines,
    totalSessions: lines.reduce((s, l) => s + l.sessionCount, 0),
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getPlans(): Promise<Plan[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("plans")
    .select("id, name, type, price_cents, is_active, created_at, plan_lines(id, service_type_id, session_count, service_types(name))")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error || !data) return []
  return (data as RawPlan[]).map(mapPlan)
}

// Returns active plans with total sessions — for the subscription dropdown.
export async function getActivePlanSummaries(): Promise<PlanSummary[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("plans")
    .select("id, name, price_cents, is_active, plan_lines(session_count)")
    .eq("organisation_id", scope.organisationId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error || !data) return []

  return (data as { id: string; name: string; price_cents: number; is_active: boolean; plan_lines: { session_count: number }[] }[]).map((p) => ({
    id:            p.id,
    name:          p.name,
    priceCents:    p.price_cents,
    isActive:      p.is_active,
    totalSessions: p.plan_lines.reduce((s, l) => s + l.session_count, 0),
  }))
}

export async function getClientActivePlansForClient(clientId: string): Promise<ClientActivePlan[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("client_plans")
    .select("id, sessions_total, sessions_used, plans(name)")
    .eq("organisation_id", scope.organisationId)
    .eq("client_id", clientId)

  if (error || !data) return []

  return (data as { id: string; sessions_total: number; sessions_used: number; plans: { name: string } | { name: string }[] | null }[])
    .map((row) => {
      const planName = row.plans
        ? (Array.isArray(row.plans) ? row.plans[0]?.name : row.plans.name) ?? null
        : null
      return {
        id:                row.id,
        planName,
        sessionsUsed:      row.sessions_used,
        sessionsTotal:     row.sessions_total,
        sessionsRemaining: row.sessions_total - row.sessions_used,
      }
    })
    .filter((p) => p.sessionsRemaining > 0)
}

export async function getClientPlans(): Promise<ClientPlan[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("client_plans")
    .select("id, client_id, plan_id, sessions_total, sessions_used, price_paid_cents, purchased_on, created_at, clients(name, member_id), plans(name)")
    .eq("organisation_id", scope.organisationId)
    .order("created_at", { ascending: false })
    .limit(200)

  if (error || !data) return []

  return (data as RawClientPlan[]).map((row) => {
    const client = resolveClient(row.clients)
    return {
      id:               row.id,
      clientId:         row.client_id,
      clientName:       client.name,
      clientMemberId:   client.member_id,
      planId:           row.plan_id,
      planName:         resolvePlan(row.plans),
      sessionsTotal:    row.sessions_total,
      sessionsUsed:     row.sessions_used,
      sessionsRemaining: row.sessions_total - row.sessions_used,
      pricePaidCents:   row.price_paid_cents,
      purchasedOn:      row.purchased_on,
      createdAt:        row.created_at,
    }
  })
}
