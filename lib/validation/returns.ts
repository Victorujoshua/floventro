import { z } from "zod"

export const returnSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  note: z.string().max(500).optional().or(z.literal("")),
})

export type ReturnInput = z.infer<typeof returnSchema>
