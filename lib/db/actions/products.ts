"use server"

import { createAppServerClient } from "@/lib/supabase/app-server"
import { requireRole } from "@/lib/auth/guards"
import { productSchema, type ProductInput } from "@/lib/validation/products"

type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string }

export async function createProductAction(
  input: ProductInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = productSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("products")
    .insert({
      organisation_id: scope.organisationId,
      sku: parsed.data.sku,
      name: parsed.data.name,
      description: parsed.data.description || null,
      reorder_point: parsed.data.reorderPoint,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      default_price_cents: parsed.data.defaultPriceNaira != null ? Math.round(parsed.data.defaultPriceNaira * 100) : null,
    } as any)
    .select("id")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "sku_taken", code: "sku_taken" }
    }
    return { ok: false, error: error.message }
  }

  return { ok: true, data: { id: data.id } }
}

export async function updateProductAction(
  id: string,
  input: ProductInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = productSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const scope = await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const { data, error } = await supabase
    .from("products")
    .update({
      sku: parsed.data.sku,
      name: parsed.data.name,
      description: parsed.data.description || null,
      reorder_point: parsed.data.reorderPoint,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      default_price_cents: parsed.data.defaultPriceNaira != null ? Math.round(parsed.data.defaultPriceNaira * 100) : null,
    } as any)
    .eq("id", id)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .select("id")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "sku_taken", code: "sku_taken" }
    }
    return { ok: false, error: error.message }
  }
  if (!data) return { ok: false, error: "Product not found" }

  return { ok: true, data: { id: data.id } }
}

export async function deleteProductAction(id: string): Promise<ActionResult> {
  const scope = await requireRole("owner", "inventory")
  const supabase = await createAppServerClient()

  const { error } = await supabase
    .from("products")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)

  if (error) return { ok: false, error: error.message }

  return { ok: true, data: null }
}
