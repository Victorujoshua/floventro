"use server"

import { requireOwner } from "@/lib/auth/guards"
import { createAppServerClient, createAppServiceRoleClient } from "@/lib/supabase/app-server"

export type LedgerExportRow = {
  date: string
  branch: string
  product_name: string
  product_sku: string
  quantity_delta: number
  reason: string
  adjustment_reason: string
  reference_type: string
  holder: string
  created_by: string
  note: string
}

type RawLedgerRow = {
  id: string
  created_at: string
  quantity_delta: number
  reason: string
  adjustment_reason: string | null
  reference_type: string | null
  note: string | null
  holder_user_id: string | null
  created_by: string | null
  branches: { name: string } | { name: string }[] | null
  products: { name: string; sku: string } | { name: string; sku: string }[] | null
}

export async function fetchOrgLedgerAction(
  from: string,
  to: string,
): Promise<LedgerExportRow[]> {
  const scope = await requireOwner()
  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("stock_ledger")
    .select(
      "id, created_at, quantity_delta, reason, adjustment_reason, reference_type, note, holder_user_id, created_by, branches(name), products(name, sku)",
    )
    .eq("organisation_id", scope.organisationId)
    .gte("created_at", `${from}T00:00:00.000Z`)
    .lte("created_at", `${to}T23:59:59.999Z`)
    .order("created_at", { ascending: false })

  if (error || !data) return []

  const rows = data as unknown as RawLedgerRow[]

  const allUserIds = [
    ...new Set([
      ...rows.filter((r) => r.holder_user_id).map((r) => r.holder_user_id!),
      ...rows.filter((r) => r.created_by).map((r) => r.created_by!),
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

  return rows.map((row) => {
    const branchName = Array.isArray(row.branches)
      ? (row.branches[0]?.name ?? "")
      : ((row.branches as { name: string } | null)?.name ?? "")

    const product = Array.isArray(row.products)
      ? row.products[0]
      : (row.products as { name: string; sku: string } | null)

    const dateStr = new Date(row.created_at)
      .toISOString()
      .replace("T", " ")
      .substring(0, 19)

    return {
      date: dateStr,
      branch: branchName,
      product_name: product?.name ?? "",
      product_sku: product?.sku ?? "",
      quantity_delta: row.quantity_delta,
      reason: row.reason,
      adjustment_reason: row.adjustment_reason ?? "",
      reference_type: row.reference_type ?? "",
      holder: row.holder_user_id ? (userMap.get(row.holder_user_id) ?? "") : "",
      created_by: row.created_by ? (userMap.get(row.created_by) ?? "") : "",
      note: row.note ?? "",
    }
  })
}
