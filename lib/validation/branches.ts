import { z } from "zod"

export const branchSchema = z.object({
  name: z.string().min(1, "Branch name required").max(120),
})

export type BranchInput = z.infer<typeof branchSchema>
