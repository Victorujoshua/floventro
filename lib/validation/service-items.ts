import { z } from "zod"

export const measurementSchema = z.object({
  name:   z.string().min(1, "Name required").max(40),
  symbol: z.string().max(10).optional().or(z.literal("")),
})

export const serviceItemSchema = z.object({
  name:          z.string().min(1, "Name required").max(120),
  category:      z.enum(["product", "supply", "equipment"]),
  measurementId: z.string().uuid("Select a measurement").optional().or(z.literal("")),
  packageSize:   z.number().positive("Package size must be greater than 0").nullable().optional(),
  amountNaira:   z.number().min(0, "Amount must be 0 or more"),
  productId:     z.string().uuid().optional().or(z.literal("")),
  isActive:      z.boolean(),
})

export type MeasurementInput = z.infer<typeof measurementSchema>
export type ServiceItemInput  = z.infer<typeof serviceItemSchema>
