import "server-only"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"
import { fetchUserLabels } from "@/lib/db/queries/transfers"

// ── Raw shapes ────────────────────────────────────────────────────────────────

type RawProduct = { id: string; sku: string; name: string }

type RawLine = {
  id: string
  product_id: string
  quantity_requested: number
  quantity_approved: number | null
  products: RawProduct | RawProduct[] | null
}

type RawRequest = {
  id: string
  source_branch_id: string
  destination_branch_id: string
  requested_by: string
  note: string | null
  status: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  transfer_id: string | null
  created_at: string
  transfer_request_lines: RawLine[]
}

// ── Public types ──────────────────────────────────────────────────────────────

export type TransferRequestStatus =
  | "pending"
  | "approved"
  | "partially_approved"
  | "rejected"
  | "cancelled"

export type TransferRequestLine = {
  id: string
  productId: string
  productSku: string
  productName: string
  quantityRequested: number
  quantityApproved: number | null
  // Current stock at the source branch — filled for incoming pending requests only
  inStock: number | null
}

export type TransferRequest = {
  id: string
  sourceBranchId: string
  sourceBranchName: string
  destBranchId: string
  destBranchName: string
  requestedBy: string
  requesterLabel: string
  note: string | null
  status: TransferRequestStatus
  reviewerLabel: string
  reviewedAt: string | null
  reviewNote: string | null
  transferId: string | null
  createdAt: string
  lines: TransferRequestLine[]
}

export type BranchTransferRequests = {
  // Asked of this branch (this branch is the source and reviews them)
  incoming: TransferRequest[]
  // Raised by this branch (this branch is the destination)
  outgoing: TransferRequest[]
}

function resolveProduct(raw: RawProduct | RawProduct[] | null): RawProduct | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

// ── Query ─────────────────────────────────────────────────────────────────────

export async function getBranchTransferRequests(limit = 50): Promise<BranchTransferRequests> {
  const empty: BranchTransferRequests = { incoming: [], outgoing: [] }
  const scope = await getCurrentScope()
  if (!scope || !scope.branchId) return empty
  const branchId = scope.branchId

  // transfer_requests is not in the generated types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createAppServerClient()) as any

  const { data, error } = await supabase
    .from("transfer_requests")
    .select(
      "id, source_branch_id, destination_branch_id, requested_by, note, status, reviewed_by, reviewed_at, review_note, transfer_id, created_at, transfer_request_lines(id, product_id, quantity_requested, quantity_approved, products(id, sku, name))",
    )
    .eq("organisation_id", scope.organisationId)
    .or(`source_branch_id.eq.${branchId},destination_branch_id.eq.${branchId}`)
    .order("created_at", { ascending: false })
    .limit(limit)

  // Missing table (migration not applied yet) or any read error → show nothing
  // rather than breaking the transfers page.
  if (error || !data) return empty
  const rows = data as RawRequest[]
  if (rows.length === 0) return empty

  // Branch names
  const branchIds = [...new Set(rows.flatMap((r) => [r.source_branch_id, r.destination_branch_id]))]
  const branchMap = new Map<string, string>()
  const { data: branches } = await supabase.from("branches").select("id, name").in("id", branchIds)
  for (const b of (branches ?? []) as { id: string; name: string }[]) branchMap.set(b.id, b.name)

  // User labels
  const userIds = [
    ...new Set([
      ...rows.map((r) => r.requested_by),
      ...(rows.map((r) => r.reviewed_by).filter(Boolean) as string[]),
    ]),
  ]
  const userMap = await fetchUserLabels(userIds)

  // Stock on hand at this branch, for reviewing incoming pending requests
  const stockMap = new Map<string, number>()
  if (rows.some((r) => r.source_branch_id === branchId && r.status === "pending")) {
    const { data: stock } = await supabase
      .from("product_stock")
      .select("product_id, quantity")
      .eq("branch_id", branchId)
    for (const s of (stock ?? []) as { product_id: string; quantity: number }[]) {
      stockMap.set(s.product_id, s.quantity)
    }
  }

  const toRequest = (r: RawRequest): TransferRequest => {
    const isIncomingPending = r.source_branch_id === branchId && r.status === "pending"
    return {
      id: r.id,
      sourceBranchId: r.source_branch_id,
      sourceBranchName: branchMap.get(r.source_branch_id) ?? r.source_branch_id,
      destBranchId: r.destination_branch_id,
      destBranchName: branchMap.get(r.destination_branch_id) ?? r.destination_branch_id,
      requestedBy: r.requested_by,
      requesterLabel: userMap.get(r.requested_by) ?? "",
      note: r.note,
      status: r.status as TransferRequestStatus,
      reviewerLabel: r.reviewed_by ? (userMap.get(r.reviewed_by) ?? "") : "",
      reviewedAt: r.reviewed_at,
      reviewNote: r.review_note,
      transferId: r.transfer_id,
      createdAt: r.created_at,
      lines: r.transfer_request_lines.map((l) => {
        const prod = resolveProduct(l.products)
        return {
          id: l.id,
          productId: l.product_id,
          productSku: prod?.sku ?? "",
          productName: prod?.name ?? "Unknown product",
          quantityRequested: l.quantity_requested,
          quantityApproved: l.quantity_approved,
          inStock: isIncomingPending ? (stockMap.get(l.product_id) ?? 0) : null,
        }
      }),
    }
  }

  return {
    incoming: rows.filter((r) => r.source_branch_id === branchId).map(toRequest),
    outgoing: rows.filter((r) => r.destination_branch_id === branchId).map(toRequest),
  }
}
