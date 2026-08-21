import { z } from "zod"

export const serviceTypeSchema = z.object({
  name: z.string().min(1, "Name required").max(120),
  description: z.string().max(500).optional().or(z.literal("")),
  defaultPriceNaira: z.number().min(0, "Price must be 0 or more"),
  isActive: z.boolean(),
})

export const serviceUsageLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive("Quantity must be at least 1"),
})

export const serviceUsageSchema = z.object({
  serviceTypeId: z.string().uuid("Select a service"),
  customerName: z.string().min(1, "Client name is required").max(120),
  customerPhone: z.string().min(1, "Phone is required").max(40),
  memberId: z.string().max(50).optional().or(z.literal("")),
  clientEmail: z.string().email("Invalid email format").max(120).optional().or(z.literal("")),
  performedOn: z.string().min(1, "Date is required"),
  serviceFeeNaira: z.number().min(0).optional(),
  note: z.string().max(500).optional().or(z.literal("")),
  lines: z.array(serviceUsageLineSchema).min(1, "Add at least one product used"),
  clientId: z.string().uuid().optional().or(z.literal("")),
  clientPlanId: z.string().uuid().optional().or(z.literal("")),
})

export type ServiceTypeInput = z.infer<typeof serviceTypeSchema>
export type ServiceUsageInput = z.infer<typeof serviceUsageSchema>
export type ServiceUsageLine = z.infer<typeof serviceUsageLineSchema>
