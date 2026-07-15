import { z } from "zod"

export const saleLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  unitPriceNaira: z.number().min(0, "Price must be 0 or more"),
})

export const saleSchema = z.object({
  customerName: z.string().max(120).optional().or(z.literal("")),
  customerPhone: z.string().max(40).optional().or(z.literal("")),
  soldOn: z.string().min(1, "Date is required"),
  note: z.string().max(500).optional().or(z.literal("")),
  lines: z.array(saleLineSchema).min(1, "Add at least one product"),
})

export type SaleLine = z.infer<typeof saleLineSchema>
export type SaleInput = z.infer<typeof saleSchema>
