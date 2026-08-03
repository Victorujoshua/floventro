import { z } from "zod"

export const fulfilmentLineSchema = z.object({
  productId:      z.string().uuid(),
  quantity:       z.number().int().positive("Quantity must be at least 1"),
  unitPriceNaira: z.number().min(0, "Price must be 0 or more"),
})

export const createFulfilmentOrderSchema = z.object({
  distributorName:  z.string().min(1, "Distributor name is required").max(120),
  distributorPhone: z.string().max(40).optional().or(z.literal("")),
  distributorEmail: z.string().max(120).optional().or(z.literal("")),
  note:             z.string().max(500).optional().or(z.literal("")),
  paymentMethod:    z.enum(["cash", "pos", "bank_transfer", "cheque", "other"]).optional(),
  paymentStatus:    z.enum(["paid", "unpaid"]),
  lines:            z.array(fulfilmentLineSchema).min(1, "Add at least one product"),
})

export type FulfilmentLineInput = z.infer<typeof fulfilmentLineSchema>
export type CreateFulfilmentOrderInput = z.infer<typeof createFulfilmentOrderSchema>
