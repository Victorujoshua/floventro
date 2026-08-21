import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

// ── Public types ──────────────────────────────────────────────────────────────

export type Client = {
  id:             string
  organisationId: string
  name:           string
  phone:          string | null
  email:          string | null
  memberId:       string | null
  createdAt:      string
}

// ── Raw shape returned by PostgREST ───────────────────────────────────────────

type RawClient = {
  id:              string
  organisation_id: string
  name:            string
  phone:           string | null
  email:           string | null
  member_id:       string | null
  created_at:      string
}

function mapClient(row: RawClient): Client {
  return {
    id:             row.id,
    organisationId: row.organisation_id,
    name:           row.name,
    phone:          row.phone,
    email:          row.email,
    memberId:       row.member_id,
    createdAt:      row.created_at,
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getClients(): Promise<Client[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("clients")
    .select("id, organisation_id, name, phone, email, member_id, created_at")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name", { ascending: true })

  if (error || !data) return []
  return (data as RawClient[]).map(mapClient)
}

export async function searchClients(query: string): Promise<Client[]> {
  const scope = await getCurrentScope()
  if (!scope || query.trim().length === 0) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const q = `%${query.trim()}%`

  const { data, error } = await supabase
    .from("clients")
    .select("id, organisation_id, name, phone, email, member_id, created_at")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .or(`name.ilike.${q},member_id.ilike.${q}`)
    .order("name", { ascending: true })
    .limit(10)

  if (error || !data) return []
  return (data as RawClient[]).map(mapClient)
}
