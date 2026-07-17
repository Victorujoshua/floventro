import "server-only"
import { createAppServerClient, createAppServiceRoleClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export type HistoryRow = {
  id: string
  createdAt: string
  quantityDelta: number
  branchBalance: number | null  // null for holding-side rows (branch stock unchanged)
  isHolding: boolean            // true when holder_user_id IS NOT NULL
  holderLabel: string | null    // name of the holder (for isHolding rows)
  reason: string
  adjustmentReason: string | null
  note: string | null
  movementLabel: string
  createdByLabel: string
}

const ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  opening_stock: "Opening stock",
  stock_count:   "Stock count",
  damaged:       "Damaged",
  expired:       "Expired",
  lost:          "Lost",
  correction:    "Correction",
}

type RawLedgerRow = {
  id: string
  created_at: string
  quantity_delta: number
  reason: string
  adjustment_reason: string | null
  reference_type: string | null
  reference_id: string | null
  note: string | null
  holder_user_id: string | null
  created_by: string | null
}

export async function getProductStockHistory(
  productId: string,
  branchId?: string | null,
): Promise<HistoryRow[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  // Query oldest-first so we can accumulate a running branch balance.
  const baseQuery = supabase
    .from("stock_ledger")
    .select(
      "id, created_at, quantity_delta, reason, adjustment_reason, reference_type, reference_id, note, holder_user_id, created_by",
    )
    .eq("product_id", productId)
    .order("created_at", { ascending: true })

  const { data, error } = branchId
    ? await baseQuery.eq("branch_id", branchId)
    : await baseQuery

  if (error || !data) return []

  const rows = data as unknown as RawLedgerRow[]

  // ── Phase 1: collect all reference IDs ───────────────────────────────────────

  const invoiceIds = [
    ...new Set(
      rows.filter((r) => r.reason === "vendor_invoice" && r.reference_id).map((r) => r.reference_id!),
    ),
  ]

  const requestIds = [
    ...new Set(
      rows.filter((r) => r.reason === "request_fulfilment" && r.reference_id).map((r) => r.reference_id!),
    ),
  ]

  // ── Phase 2: fetch entities in parallel ──────────────────────────────────────

  type InvoiceInfo = { invoice_number: string | null; vendor_name: string }
  const invoiceMap = new Map<string, InvoiceInfo>()
  const requestToRequesterUid = new Map<string, string>() // requestId → uid

  await Promise.all([
    (async () => {
      if (invoiceIds.length === 0) return
      const { data: invoices } = await supabase
        .from("vendor_invoices")
        .select("id, invoice_number, vendors(name)")
        .in("id", invoiceIds)
      type RawInvoice = {
        id: string
        invoice_number: string | null
        vendors: { name: string } | { name: string }[] | null
      }
      for (const inv of (invoices ?? []) as unknown as RawInvoice[]) {
        const vendorName = Array.isArray(inv.vendors)
          ? inv.vendors[0]?.name
          : (inv.vendors as { name: string } | null)?.name
        invoiceMap.set(inv.id, {
          invoice_number: inv.invoice_number,
          vendor_name: vendorName ?? "Unknown vendor",
        })
      }
    })(),
    (async () => {
      if (requestIds.length === 0) return
      const { data: requests } = await supabase
        .from("stock_requests")
        .select("id, requested_by")
        .in("id", requestIds)
      type RawReq = { id: string; requested_by: string }
      for (const req of (requests ?? []) as RawReq[]) {
        requestToRequesterUid.set(req.id, req.requested_by)
      }
    })(),
  ])

  // ── Phase 3: batch-resolve ALL user names in one pass ────────────────────────
  // Covers creators, holders, and requesters to avoid multiple admin clients.

  const allUserIds = [
    ...new Set([
      ...rows.filter((r) => r.created_by).map((r) => r.created_by!),
      ...rows.filter((r) => r.holder_user_id).map((r) => r.holder_user_id!),
      ...[...requestToRequesterUid.values()],
    ]),
  ]

  const userMap = new Map<string, string>()
  if (allUserIds.length > 0) {
    const admin = createAppServiceRoleClient()
    await Promise.all(
      allUserIds.map(async (uid) => {
        const { data: ud } = await admin.auth.admin.getUserById(uid)
        const label =
          (ud.user?.user_metadata?.full_name as string) || ud.user?.email || uid
        userMap.set(uid, label)
      }),
    )
  }

  // requestId → requester label (derived from userMap now that it's populated)
  const requestMap = new Map<string, string>()
  for (const [reqId, uid] of requestToRequesterUid) {
    requestMap.set(reqId, userMap.get(uid) ?? "")
  }

  // ── Phase 4: build output rows with running branch balance ────────────────────
  //
  // Branch balance = cumulative sum of quantity_delta for holder_user_id IS NULL
  // rows only. Holding-side rows (holder IS NOT NULL) appear in the history but
  // do not move the branch balance — they are flagged with isHolding=true and
  // branchBalance=null so the UI can show "—" in that column.

  let branchBalance = 0
  const withBalance = rows.map((row) => {
    const isHolding = row.holder_user_id !== null
    const holderLabel = row.holder_user_id ? (userMap.get(row.holder_user_id) ?? null) : null

    if (!isHolding) {
      branchBalance += row.quantity_delta
    }

    let movementLabel: string
    switch (row.reason) {
      case "vendor_invoice": {
        const inv = invoiceMap.get(row.reference_id ?? "")
        if (inv) {
          const num = inv.invoice_number ? ` — Invoice ${inv.invoice_number}` : ""
          movementLabel = `Received from vendor · ${inv.vendor_name}${num}`
        } else {
          movementLabel = "Received from vendor"
        }
        break
      }
      case "request_fulfilment": {
        const requester = requestMap.get(row.reference_id ?? "")
        movementLabel = requester ? `Issued via request · ${requester}` : "Issued via request"
        break
      }
      case "adjustment": {
        const reasonLabel =
          ADJUSTMENT_REASON_LABELS[row.adjustment_reason ?? ""] ?? row.adjustment_reason ?? ""
        movementLabel = `Adjustment · ${reasonLabel}`
        break
      }
      case "issue_to_holding":
        movementLabel = holderLabel ? `Issued to ${holderLabel}` : "Issued to holding"
        break
      case "return_to_branch":
        movementLabel = holderLabel ? `Returned by ${holderLabel}` : "Returned from holding"
        break
      case "return_receipt":
        movementLabel = "Return received"
        break
      case "sale":
        movementLabel = "Sold from holding"
        break
      case "usage":
        movementLabel = "Used in service"
        break
      case "transfer_in":
        movementLabel = "Transfer in"
        break
      case "transfer_out":
        movementLabel = "Transfer out"
        break
      case "reversal":
        movementLabel = "Reversal"
        break
      default:
        movementLabel = row.reason
    }

    return {
      id: row.id,
      createdAt: row.created_at,
      quantityDelta: row.quantity_delta,
      branchBalance: isHolding ? null : branchBalance,
      isHolding,
      holderLabel,
      reason: row.reason,
      adjustmentReason: row.adjustment_reason,
      note: row.note,
      movementLabel,
      createdByLabel: row.created_by ? (userMap.get(row.created_by) ?? "") : "",
    }
  })

  return withBalance.reverse() // display newest first
}
