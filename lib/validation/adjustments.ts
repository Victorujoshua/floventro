import { z } from "zod"

export const ADJUSTMENT_REASONS = [
  "opening_stock",
  "stock_count",
  "damaged",
  "expired",
  "lost",
  "correction",
] as const

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  opening_stock: "Opening stock",
  stock_count:   "Stock count",
  damaged:       "Damaged",
  expired:       "Expired",
  lost:          "Lost",
  correction:    "Correction",
}

export const ADJUSTMENT_REASON_HINTS: Record<AdjustmentReason, string> = {
  opening_stock: "Stock you already had before using Floventro. Only available for products with no history.",
  stock_count:   "You counted the shelf and the number differs from what Floventro shows.",
  damaged:       "Units were damaged and cannot be sold or used.",
  expired:       "Units passed their expiry date.",
  lost:          "Units are missing — theft, misplacement, or unknown cause.",
  correction:    "A previous entry was wrong and needs to be corrected.",
}

export const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  mode: z.enum(["set", "adjust"]),
  newQuantity: z.number().int().min(0, "Quantity cannot be negative").optional(),
  delta: z.number().int().optional(),
  adjustmentReason: z.enum(ADJUSTMENT_REASONS, { error: "Select a reason" }),
  note: z.string().max(500).optional().or(z.literal("")),
})

export type AdjustmentInput = z.infer<typeof adjustmentSchema>
