import { z } from "zod"

export const inviteSchema = z.object({
  email: z.string().email("Enter a valid email"),
  role: z.enum(["inventory", "sales", "internal_use", "admin"]),
})

export type InviteInput = z.infer<typeof inviteSchema>
