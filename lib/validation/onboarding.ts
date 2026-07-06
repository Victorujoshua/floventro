import { z } from "zod"

export const createOrgSchema = z.object({
  name: z.string().min(2, "Please enter your organisation name").max(120),
  countryCode: z.string().length(2),
  currency: z.string().length(3),
  timezone: z.string().min(3),
})

export type CreateOrgInput = z.infer<typeof createOrgSchema>
