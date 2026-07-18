import { z } from "zod"

export const payoutAccountSchema = z.object({
  accountName:   z.string().max(120).optional().or(z.literal("")),
  accountNumber: z.string().max(30).optional().or(z.literal("")),
  bankName:      z.string().max(120).optional().or(z.literal("")),
})

export type PayoutAccountInput = z.infer<typeof payoutAccountSchema>
