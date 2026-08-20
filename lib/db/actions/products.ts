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

  const scope = await requireRole("owner", "inventory", "admin")
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

  // List the new product in branch_products immediately so branch-scoped viewers see it.
  // Mirrors the on-stock-arrival inserts in receive_invoice_stock / receive_transfer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bp = supabase as any
  if (scope.branchId) {
    await bp.from("branch_products").upsert(
      { organisation_id: scope.organisationId, branch_id: scope.branchId, product_id: data.id },
      { onConflict: "branch_id,product_id", ignoreDuplicates: true },
    )
  } else {
    const { data: branches } = await supabase
      .from("branches")
      .select("id")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)
    if (branches && (branches as { id: string }[]).length > 0) {
      await bp.from("branch_products").upsert(
        (branches as { id: string }[]).map((b) => ({
          organisation_id: scope.organisationId,
          branch_id: b.id,
          product_id: data.id,
        })),
        { onConflict: "branch_id,product_id", ignoreDuplicates: true },
      )
    }
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

  const scope = await requireRole("owner", "inventory", "admin")
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
  const scope = await requireRole("owner", "inventory", "admin")
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
