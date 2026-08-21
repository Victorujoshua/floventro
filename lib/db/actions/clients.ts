"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import { clientSchema, type ClientInput } from "@/lib/validation/clients"
import { getClients, searchClients, type Client } from "@/lib/db/queries/clients"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function getClientsAction(): Promise<Client[]> {
  return getClients()
}

export async function searchClientsAction(query: string): Promise<Client[]> {
  return searchClients(query)
}

export async function createClientAction(input: ClientInput): Promise<ActionResult<{ id: string }>> {
  const parsed = clientSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory", "admin", "sales")
  const supabase = await createAppServerClient()

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) return { ok: false, error: "auth" }

  const { data, error } = await supabase
    .from("clients")
    .insert({
      organisation_id: scope.organisationId,
      name:      parsed.data.name.trim(),
      phone:     parsed.data.phone?.trim()    || null,
      email:     parsed.data.email?.trim()    || null,
      member_id: parsed.data.memberId?.trim() || null,
      created_by: authData.user.id,
    })
    .select("id")
    .single()

  if (error) {
    console.error("[createClientAction]", error)
    if (error.code === "23505") {
      return { ok: false, error: "duplicate_member_id", message: "A client with this Member ID already exists." }
    }
    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: { id: data.id } }
}

export async function updateClientAction(id: string, input: ClientInput): Promise<ActionResult> {
  const parsed = clientSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  await requireRole("owner", "inventory", "admin", "sales")
  const supabase = await createAppServerClient()

  const { error } = await supabase
    .from("clients")
    .update({
      name:      parsed.data.name.trim(),
      phone:     parsed.data.phone?.trim()    || null,
      email:     parsed.data.email?.trim()    || null,
      member_id: parsed.data.memberId?.trim() || null,
    })
    .eq("id", id)

  if (error) {
    console.error("[updateClientAction]", error)
    if (error.code === "23505") {
      return { ok: false, error: "duplicate_member_id", message: "A client with this Member ID already exists." }
    }
    return { ok: false, error: "server", message: "Something went wrong. Please try again." }
  }

  return { ok: true, data: null }
}
