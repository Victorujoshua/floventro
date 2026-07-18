import "server-only"
import { createAppServerClient, createAppServiceRoleClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

// ── Raw shapes ────────────────────────────────────────────────────────────────

type RawProduct = { id: string; sku: string; name: string }

type RawLine = {
  id: string
  product_id: string
  quantity_sent: number
  quantity_received: number | null
  products: RawProduct | RawProduct[] | null
}

type RawTransfer = {
  id: string
  organisation_id: string
  source_branch_id: string
  dest_branch_id: string
  status: string
  initiated_by: string
  received_by: string | null
  cancelled_by: string | null
  initiated_at: string
  received_at: string | null
  cancelled_at: string | null
  note: string | null
  created_at: string
  stock_transfer_lines: RawLine[]
}

function resolveProduct(raw: RawProduct | RawProduct[] | null): RawProduct | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

// ── Public types ──────────────────────────────────────────────────────────────

export type TransferLine = {
  id: string
  productId: string
  productSku: string
  productName: string
  quantitySent: number
  quantityReceived: number | null
}

export type Transfer = {
  id: string
  sourceBranchId: string
  sourceBranchName: string
  destBranchId: string
  destBranchName: string
  status: "in_transit" | "received" | "cancelled"
  initiatedByLabel: string
  initiatedAt: string
  receivedAt: string | null
  cancelledAt: string | null
  note: string | null
  lines: TransferLine[]
}

export type OrgBranch = { id: string; name: string }
export type OrgProduct = { id: string; sku: string; name: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchUserLabels(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const admin = createAppServiceRoleClient()
  const map = new Map<string, string>()
  await Promise.all(
    userIds.map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid)
      const user = data.user
      const label =
        (user?.user_metadata?.full_name as string) ||
        user?.email ||
        uid
      map.set(uid, label)
    }),
  )
  return map
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getTransfers(limit = 50): Promise<Transfer[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("stock_transfers")
    .select(
      "id, organisation_id, source_branch_id, dest_branch_id, status, initiated_by, received_by, cancelled_by, initiated_at, received_at, cancelled_at, note, created_at, stock_transfer_lines(id, product_id, quantity_sent, quantity_received, products(id, sku, name))",
    )
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error || !data) return []

  const transfers = data as unknown as RawTransfer[]

  // Batch-resolve branch names
  const branchIds = [
    ...new Set(transfers.flatMap((t) => [t.source_branch_id, t.dest_branch_id])),
  ]
  const branchMap = new Map<string, string>()
  if (branchIds.length > 0) {
    const { data: branches } = await supabase
      .from("branches")
      .select("id, name")
      .in("id", branchIds)
    for (const b of (branches ?? []) as { id: string; name: string }[]) {
      branchMap.set(b.id, b.name)
    }
  }

  // Batch-resolve user labels
  const userIds = [
    ...new Set([
      ...transfers.map((t) => t.initiated_by),
      ...(transfers.map((t) => t.received_by).filter(Boolean) as string[]),
      ...(transfers.map((t) => t.cancelled_by).filter(Boolean) as string[]),
    ]),
  ]
  const userMap = await fetchUserLabels(userIds)

  return transfers.map((t) => ({
    id: t.id,
    sourceBranchId: t.source_branch_id,
    sourceBranchName: branchMap.get(t.source_branch_id) ?? t.source_branch_id,
    destBranchId: t.dest_branch_id,
    destBranchName: branchMap.get(t.dest_branch_id) ?? t.dest_branch_id,
    status: t.status as Transfer["status"],
    initiatedByLabel: userMap.get(t.initiated_by) ?? "",
    initiatedAt: t.initiated_at,
    receivedAt: t.received_at,
    cancelledAt: t.cancelled_at,
    note: t.note,
    lines: t.stock_transfer_lines.map((l) => {
      const prod = resolveProduct(l.products)
      return {
        id: l.id,
        productId: l.product_id,
        productSku: prod?.sku ?? "",
        productName: prod?.name ?? "Unknown product",
        quantitySent: l.quantity_sent,
        quantityReceived: l.quantity_received,
      }
    }),
  }))
}

export async function getOrgBranches(): Promise<OrgBranch[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()
  const { data } = await supabase
    .from("branches")
    .select("id, name")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name")

  return (data ?? []) as OrgBranch[]
}

export async function getOrgProducts(): Promise<OrgProduct[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()
  const { data } = await supabase
    .from("products")
    .select("id, sku, name")
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .order("name")

  return (data ?? []) as OrgProduct[]
}
