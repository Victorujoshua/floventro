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

// Two-phase booking schema: no products. Used by create_service_session RPC.
// When clientId is set (linked client), identity fields are pre-filled from
// the record — format validation is skipped (trust the stored value).
// When no client (walk-in), name, phone, and email format are all required.
export const serviceSessionSchema = z.object({
  serviceTypeId:   z.string().uuid("Select a service"),
  customerName:    z.string().max(120),
  customerPhone:   z.string().max(40),
  memberId:        z.string().max(50).optional().or(z.literal("")),
  clientEmail:     z.string().max(120).optional().or(z.literal("")),
  performedOn:     z.string().min(1, "Date is required"),
  serviceFeeNaira: z.number().min(0).optional(),
  note:            z.string().max(500).optional().or(z.literal("")),
  clientId:        z.string().uuid().optional().or(z.literal("")),
  clientPlanId:    z.string().uuid().optional().or(z.literal("")),
}).superRefine((data, ctx) => {
  const hasClient = !!data.clientId
  if (!hasClient) {
    if (!data.customerName || data.customerName.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Client name is required", path: ["customerName"] })
    }
    if (!data.customerPhone || data.customerPhone.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Phone is required", path: ["customerPhone"] })
    }
    if (data.clientEmail && data.clientEmail.trim().length > 0) {
      const emailOk = z.string().email().safeParse(data.clientEmail).success
      if (!emailOk) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid email format", path: ["clientEmail"] })
      }
    }
  }
})

export type ServiceTypeInput    = z.infer<typeof serviceTypeSchema>
export type ServiceUsageInput   = z.infer<typeof serviceUsageSchema>
export type ServiceUsageLine    = z.infer<typeof serviceUsageLineSchema>
export type ServiceSessionInput = z.infer<typeof serviceSessionSchema>
