import { z } from "zod"

export const inviteSchema = z.object({
  email: z.string().email("Enter a valid email"),
  role: z.enum(["inventory", "sales", "internal_use"]),
  branchId: z.string().uuid("Select a branch").optional(),
})

export type InviteInput = z.infer<typeof inviteSchema>
