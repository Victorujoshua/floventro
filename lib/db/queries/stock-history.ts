import "server-only"
import { createAppServerClient, createAppServiceRoleClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export type HistoryRow = {
  id: string
  createdAt: string
  quantityDelta: number
  balance: number
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
  created_by: string | null
}

export async function getProductStockHistory(
  productId: string,
  branchId?: string | null,
): Promise<HistoryRow[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  const supabase = await createAppServerClient()

  // Query oldest-first so we can accumulate a running balance.
  const baseQuery = supabase
    .from("stock_ledger")
    .select(
      "id, created_at, quantity_delta, reason, adjustment_reason, reference_type, reference_id, note, created_by",
    )
    .eq("product_id", productId)
    .order("created_at", { ascending: true })

  const { data, error } = branchId
    ? await baseQuery.eq("branch_id", branchId)
    : await baseQuery

  if (error || !data) return []

  const rows = data as unknown as RawLedgerRow[]

  // ── Batch-fetch reference details ─────────────────────────────────────────────

  // Vendor invoices (for reason = 'vendor_invoice')
  const invoiceIds = [
    ...new Set(
      rows.filter((r) => r.reason === "vendor_invoice" && r.reference_id).map((r) => r.reference_id!),
    ),
  ]
  type InvoiceInfo = { invoice_number: string | null; vendor_name: string }
  const invoiceMap = new Map<string, InvoiceInfo>()

  if (invoiceIds.length > 0) {
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
  }

  // Stock requests (for reason = 'request_fulfilment')
  const requestIds = [
    ...new Set(
      rows.filter((r) => r.reason === "request_fulfilment" && r.reference_id).map((r) => r.reference_id!),
    ),
  ]
  const requestMap = new Map<string, string>() // requestId → requester label

  if (requestIds.length > 0) {
    const { data: requests } = await supabase
      .from("stock_requests")
      .select("id, requested_by")
      .in("id", requestIds)

    type RawReq = { id: string; requested_by: string }
    if (requests && requests.length > 0) {
      const requesterIds = [...new Set((requests as RawReq[]).map((r) => r.requested_by))]
      const admin = createAppServiceRoleClient()
      const userLabels = new Map<string, string>()
      await Promise.all(
        requesterIds.map(async (uid) => {
          const { data: ud } = await admin.auth.admin.getUserById(uid)
          const label =
            (ud.user?.user_metadata?.full_name as string) || ud.user?.email || uid
          userLabels.set(uid, label)
        }),
      )
      for (const req of requests as RawReq[]) {
        requestMap.set(req.id, userLabels.get(req.requested_by) ?? "")
      }
    }
  }

  // Created-by names
  const creatorIds = [...new Set(rows.filter((r) => r.created_by).map((r) => r.created_by!))]
  const creatorMap = new Map<string, string>()
  if (creatorIds.length > 0) {
    const admin = createAppServiceRoleClient()
    await Promise.all(
      creatorIds.map(async (uid) => {
        const { data: ud } = await admin.auth.admin.getUserById(uid)
        const label =
          (ud.user?.user_metadata?.full_name as string) || ud.user?.email || uid
        creatorMap.set(uid, label)
      }),
    )
  }

  // ── Build output rows with running balance ────────────────────────────────────

  let balance = 0
  const withBalance = rows.map((row) => {
    balance += row.quantity_delta

    let movementLabel: string
    switch (row.reason) {
      case "vendor_invoice": {
        const inv = invoiceMap.get(row.reference_id ?? "")
        const num = inv?.invoice_number ? `Invoice ${inv.invoice_number}` : "Vendor invoice"
        movementLabel = inv ? `${num} · ${inv.vendor_name}` : "Vendor invoice"
        break
      }
      case "request_fulfilment": {
        const requester = requestMap.get(row.reference_id ?? "")
        movementLabel = requester ? `Request fulfilled · ${requester}` : "Request fulfilled"
        break
      }
      case "adjustment": {
        const reasonLabel = ADJUSTMENT_REASON_LABELS[row.adjustment_reason ?? ""] ?? row.adjustment_reason ?? ""
        movementLabel = `Adjustment · ${reasonLabel}`
        break
      }
      case "sale":
        movementLabel = "Sale"
        break
      case "usage":
        movementLabel = "Internal use"
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
      balance,
      reason: row.reason,
      adjustmentReason: row.adjustment_reason,
      note: row.note,
      movementLabel,
      createdByLabel: row.created_by ? (creatorMap.get(row.created_by) ?? "") : "",
    }
  })

  return withBalance.reverse() // display newest first
}
