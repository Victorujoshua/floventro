"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireScope } from "@/lib/auth/guards"
import {
  createFulfilmentOrderSchema,
  type CreateFulfilmentOrderInput,
} from "@/lib/validation/fulfilment"
import { getFulfilmentOrderById, getFulfilmentOrders } from "@/lib/db/queries/fulfilment"
import type { FulfilmentOrder } from "@/lib/db/queries/fulfilment"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; message?: string }

export async function getFulfilmentOrdersAction(): Promise<FulfilmentOrder[]> {
  await requireScope()
  return getFulfilmentOrders()
}

export async function getFulfilmentOrderAction(id: string): Promise<FulfilmentOrder | null> {
  await requireScope()
  return getFulfilmentOrderById(id)
}

export async function createFulfilmentOrderAction(
  input: CreateFulfilmentOrderInput,
): Promise<ActionResult<{ orderId: string }>> {
  const parsed = createFulfilmentOrderSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireScope()
  const branchId = scope.branchId
  if (!branchId) {
    return { ok: false, error: "branch_required", message: "Select a branch before creating a fulfilment order." }
  }

  const supabase = await createAppServerClient()

  const pLines = parsed.data.lines.map((l) => ({
    product_id:       l.productId,
    quantity:         l.quantity,
    unit_price_cents: Math.round(l.unitPriceNaira * 100),
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("create_fulfilment_order", {
    p_branch_id:         branchId,
    p_distributor_name:  parsed.data.distributorName,
    p_distributor_phone: parsed.data.distributorPhone || null,
    p_distributor_email: parsed.data.distributorEmail || null,
    p_note:              parsed.data.note || null,
    p_payment_method:    parsed.data.paymentMethod ?? null,
    p_payment_status:    parsed.data.paymentStatus,
    p_lines:             pLines,
  })

  if (error) return { ok: false, error: "server", message: error.message }
  return { ok: true, data: { orderId: data as string } }
}

export async function packFulfilmentOrderAction(orderId: string): Promise<ActionResult> {
  await requireScope()
  const supabase = await createAppServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("pack_fulfilment_order", { p_order_id: orderId })
  if (error) return { ok: false, error: "server", message: error.message }
  return { ok: true, data: null }
}

export async function shipFulfilmentOrderAction(orderId: string): Promise<ActionResult> {
  await requireScope()
  const supabase = await createAppServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("ship_fulfilment_order", { p_order_id: orderId })
  if (error) return { ok: false, error: "server", message: error.message }
  return { ok: true, data: null }
}

export async function deliverFulfilmentOrderAction(orderId: string): Promise<ActionResult> {
  await requireScope()
  const supabase = await createAppServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("deliver_fulfilment_order", { p_order_id: orderId })
  if (error) return { ok: false, error: "server", message: error.message }
  return { ok: true, data: null }
}

export async function cancelFulfilmentOrderAction(
  orderId: string,
  note?: string,
): Promise<ActionResult> {
  await requireScope()
  const supabase = await createAppServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("cancel_fulfilment_order", {
    p_order_id: orderId,
    p_note:     note ?? null,
  })
  if (error) return { ok: false, error: "server", message: error.message }
  return { ok: true, data: null }
}
