import "server-only"
import { createAppServerClient, createAppServiceRoleClient } from "@/lib/supabase/app-server"
import { getCurrentScope } from "@/lib/auth/scope"

export type InvoicePayment = {
  id:            string
  amount_cents:  number
  wht_rate:      number | null
  wht_cents:     number | null
  paid_on:       string
  method:        string
  reference:     string | null
  note:          string | null
  created_at:    string
  recorder_name: string
}

type RawPaymentRow = {
  id:          string
  amount_cents: number
  wht_rate:    number | null
  wht_cents:   number | null
  paid_on:     string
  method:      string
  reference:   string | null
  note:        string | null
  created_at:  string
  created_by:  string | null
}

export async function getInvoicePayments(invoiceId: string): Promise<InvoicePayment[]> {
  const scope = await getCurrentScope()
  if (!scope) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createAppServerClient() as any

  const { data, error } = await supabase
    .from("vendor_payments")
    .select("id, amount_cents, wht_rate, wht_cents, paid_on, method, reference, note, created_at, created_by")
    .eq("invoice_id", invoiceId)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false })

  if (error || !data) return []

  const rows = data as RawPaymentRow[]
  const userIds = [...new Set(rows.map((p) => p.created_by).filter(Boolean) as string[])]

  const nameMap = new Map<string, string>()
  if (userIds.length > 0) {
    const admin = createAppServiceRoleClient()
    await Promise.all(
      userIds.map(async (uid) => {
        const { data: userData } = await admin.auth.admin.getUserById(uid)
        const name =
          (userData.user?.user_metadata?.full_name as string) ||
          userData.user?.email ||
          uid
        nameMap.set(uid, name)
      }),
    )
  }

  return rows.map((p) => ({
    id:            p.id,
    amount_cents:  p.amount_cents,
    wht_rate:      p.wht_rate,
    wht_cents:     p.wht_cents,
    paid_on:       p.paid_on,
    method:        p.method,
    reference:     p.reference,
    note:          p.note,
    created_at:    p.created_at,
    recorder_name: p.created_by ? (nameMap.get(p.created_by) ?? p.created_by) : "—",
  }))
}
