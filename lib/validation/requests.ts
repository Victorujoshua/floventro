import { z } from "zod"

export const requestLineSchema = z.object({
  productId: z.string().uuid("Select a product"),
  quantity: z.number().int().positive("Quantity must be at least 1"),
})

export const requestSchema = z.object({
  branchId: z.string().uuid().optional(),
  purpose: z.string().max(500).optional().or(z.literal("")),
  lines: z.array(requestLineSchema).min(1, "Add at least one product"),
})

export type RequestInput = z.infer<typeof requestSchema>
export type RequestLineInput = z.infer<typeof requestLineSchema>
