import { z } from "zod"

export const waitlistSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  fullName: z.string().optional(),
  company: z.string().optional(),
  role: z.string().optional(),
  branchCount: z.string().optional(),
  referrer: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
})

export type WaitlistInput = z.infer<typeof waitlistSchema>
