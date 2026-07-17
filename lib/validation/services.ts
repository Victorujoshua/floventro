import { z } from "zod"

export const serviceTypeSchema = z.object({
  name: z.string().min(1, "Name required").max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean(),
})

export const serviceUsageLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive("Quantity must be at least 1"),
})

export const serviceUsageSchema = z.object({
  serviceTypeId: z.string().uuid("Select a service"),
  customerName: z.string().max(120).optional().or(z.literal("")),
  customerPhone: z.string().max(40).optional().or(z.literal("")),
  performedOn: z.string().min(1, "Date is required"),
  serviceFeeNaira: z.number().min(0).optional(),
  note: z.string().max(500).optional().or(z.literal("")),
  lines: z.array(serviceUsageLineSchema).min(1, "Add at least one product used"),
})

export type ServiceTypeInput = z.infer<typeof serviceTypeSchema>
export type ServiceUsageInput = z.infer<typeof serviceUsageSchema>
export type ServiceUsageLine = z.infer<typeof serviceUsageLineSchema>
