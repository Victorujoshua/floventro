import { z } from "zod"

export const clientSchema = z.object({
  name:     z.string().min(1, "Name is required").max(120),
  phone:    z.string().max(40).optional().or(z.literal("")),
  email:    z.string().email("Invalid email").max(120).optional().or(z.literal("")),
  memberId: z.string().max(50).optional().or(z.literal("")),
})

export type ClientInput = z.infer<typeof clientSchema>
