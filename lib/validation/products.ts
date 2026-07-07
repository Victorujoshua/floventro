import { z } from "zod"

export const productSchema = z.object({
  sku: z.string().min(1, "SKU is required").max(64),
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  reorderPoint: z.number().int().min(0),
})

export type ProductInput = z.infer<typeof productSchema>
