import { z } from "zod"

export const planLineSchema = z.object({
  serviceTypeId: z.string().uuid("Select a service"),
  sessionCount:  z.number().int().min(1, "At least 1 session"),
})

export const planSchema = z.object({
  name:       z.string().min(1, "Name is required").max(120),
  type:       z.enum(["single", "package"]),
  priceNaira: z.number().min(0, "Price must be 0 or more"),
  lines:      z.array(planLineSchema).min(1, "Add at least one service line"),
})

// sessionsTotal is NOT in this schema — it is computed server-side from
// plan_lines at subscription creation time and never trusted from the form.
export const clientPlanSchema = z.object({
  clientId:       z.string().uuid("Select a client"),
  planId:         z.string().uuid("Select a plan"),
  pricePaidNaira: z.number().min(0, "Price must be 0 or more"),
  purchasedOn:    z.string().min(1, "Date is required"),
})

export type PlanLineInput   = z.infer<typeof planLineSchema>
export type PlanInput       = z.infer<typeof planSchema>
export type ClientPlanInput = z.infer<typeof clientPlanSchema>
