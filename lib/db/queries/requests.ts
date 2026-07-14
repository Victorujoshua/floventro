import { createAppServerClient, createAppServiceRoleClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

// ── Raw shapes returned by Supabase nested selects ────────────────────────────

type RawProduct = { id: string; sku: string; name: string }

type RawLine = {
  id: string
  quantity_requested: number
  quantity_approved: number | null
  products: RawProduct | RawProduct[] | null
}

type RawRequest = {
  id: string
  branch_id: string
  purpose: string | null
  status: string
  created_at: string
  requested_by: string
  reviewed_at: string | null
  review_note: string | null
  stock_request_lines: RawLine[]
}

function resolveProduct(raw: RawProduct | RawProduct[] | null): RawProduct | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

// ── Public types ──────────────────────────────────────────────────────────────

export type RequestLine = {
  id: string
  productId: string
  productSku: string
  productName: string
  quantityRequested: number
  quantityApproved: number | null
}

export type MyRequest = {
  id: string
  purpose: string | null
  status: string
  createdAt: string
  lines: RequestLine[]
}

export type PendingRequest = {
  id: string
  branchId: string
  purpose: string | null
  createdAt: string
  requesterName: string
  requesterEmail: string
  lines: (RequestLine & { inStock: number })[]
}

export type ReviewedRequest = {
  id: string
  purpose: string | null
  status: string
  createdAt: string
  reviewedAt: string | null
  reviewNote: string | null
  requesterLabel: string
  lines: RequestLine[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchUserMap(userIds: string[]): Promise<Map<string, { name: string; email: string }>> {
  const admin = createAppServiceRoleClient()
  const map = new Map<string, { name: string; email: string }>()
  await Promise.all(
    userIds.map(async (uid) => {
      const { data } = await admin.auth.admin.getUserById(uid)
      map.set(uid, {
        name: (data.user?.user_metadata?.full_name as string) ?? "",
        email: data.user?.email ?? uid,
      })
    }),
  )
  return map
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getMyRequests(): Promise<MyRequest[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from("stock_requests")
    .select(
      "id, purpose, status, created_at, requested_by, stock_request_lines(id, quantity_requested, quantity_approved, products(id, sku, name))",
    )
    .eq("requested_by", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error || !data) return []

  return (data as unknown as RawRequest[]).map((req) => ({
    id: req.id,
    purpose: req.purpose,
    status: req.status,
    createdAt: req.created_at,
    lines: req.stock_request_lines.map((l) => {
      const prod = resolveProduct(l.products)
      return {
        id: l.id,
        productId: prod?.id ?? "",
        productSku: prod?.sku ?? "",
        productName: prod?.name ?? "Unknown product",
        quantityRequested: l.quantity_requested,
        quantityApproved: l.quantity_approved,
      }
    }),
  }))
}

export async function getPendingRequests(): Promise<PendingRequest[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("stock_requests")
    .select(
      "id, branch_id, purpose, created_at, requested_by, stock_request_lines(id, quantity_requested, products(id, sku, name))",
    )
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })

  if (error || !data) return []

  const requests = data as unknown as (Omit<RawRequest, "quantity_approved" | "reviewed_at" | "review_note" | "status"> & {
    stock_request_lines: Omit<RawLine, "quantity_approved">[]
  })[]

  // Batch-fetch product_stock for all (branch, product) pairs
  const stockMap = new Map<string, number>()
  const branchIds: string[] = []
  const productIds: string[] = []
  for (const req of requests) {
    branchIds.push(req.branch_id)
    for (const line of req.stock_request_lines) {
      const prod = resolveProduct(line.products)
      if (prod?.id) productIds.push(prod.id)
    }
  }

  if (productIds.length > 0) {
    const { data: stockRows } = await supabase
      .from("product_stock")
      .select("branch_id, product_id, quantity")
      .in("branch_id", [...new Set(branchIds)])
      .in("product_id", [...new Set(productIds)])

    for (const row of (stockRows ?? []) as { branch_id: string; product_id: string; quantity: number }[]) {
      stockMap.set(`${row.branch_id}:${row.product_id}`, row.quantity ?? 0)
    }
  }

  // Requester names via service role
  const requesterIds = [...new Set(requests.map((r) => r.requested_by))]
  const userMap = await fetchUserMap(requesterIds)

  return requests.map((req) => ({
    id: req.id,
    branchId: req.branch_id,
    purpose: req.purpose,
    createdAt: req.created_at,
    requesterName: userMap.get(req.requested_by)?.name ?? "",
    requesterEmail: userMap.get(req.requested_by)?.email ?? "",
    lines: req.stock_request_lines.map((l) => {
      const prod = resolveProduct(l.products)
      const inStock = stockMap.get(`${req.branch_id}:${prod?.id}`) ?? 0
      return {
        id: l.id,
        productId: prod?.id ?? "",
        productSku: prod?.sku ?? "",
        productName: prod?.name ?? "Unknown product",
        quantityRequested: l.quantity_requested,
        quantityApproved: null,
        inStock,
      }
    }),
  }))
}

export async function getReviewedRequests(limit = 30): Promise<ReviewedRequest[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("stock_requests")
    .select(
      "id, purpose, status, created_at, reviewed_at, review_note, requested_by, stock_request_lines(id, quantity_requested, quantity_approved, products(id, sku, name))",
    )
    .neq("status", "pending")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error || !data) return []

  const requests = data as unknown as RawRequest[]
  const requesterIds = [...new Set(requests.map((r) => r.requested_by))]
  const userMap = await fetchUserMap(requesterIds)

  return requests.map((req) => {
    const info = userMap.get(req.requested_by)
    return {
      id: req.id,
      purpose: req.purpose,
      status: req.status,
      createdAt: req.created_at,
      reviewedAt: req.reviewed_at,
      reviewNote: req.review_note,
      requesterLabel: info?.name || info?.email || "",
      lines: req.stock_request_lines.map((l) => {
        const prod = resolveProduct(l.products)
        return {
          id: l.id,
          productId: prod?.id ?? "",
          productSku: prod?.sku ?? "",
          productName: prod?.name ?? "Unknown product",
          quantityRequested: l.quantity_requested,
          quantityApproved: l.quantity_approved,
        }
      }),
    }
  })
}

export async function getPendingRequestCount(): Promise<number> {
  const scope = await getCurrentScope()
  if (!scope) return 0
  if (scope.role !== "owner" && scope.role !== "inventory") return 0

  const supabase = await createAppServerClient()
  const { count, error } = await supabase
    .from("stock_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .is("deleted_at", null)

  if (error) return 0
  return count ?? 0
}
