import { z } from "zod"

const requestLineSchema = z.object({
  productId: z.string().uuid("Select a product"),
  quantity: z.number().int().positive("Quantity must be at least 1"),
})

// destination is resolved server-side from scope.branchId in createTransferRequestAction.
export const createTransferRequestSchema = z.object({
  sourceBranchId: z.string().uuid("Select the branch to request from"),
  note: z.string().max(1000).optional().or(z.literal("")),
  lines: z
    .array(requestLineSchema)
    .min(1, "Add at least one product line")
    .refine(
      (lines) => new Set(lines.map((l) => l.productId)).size === lines.length,
      "Each product can only be listed once",
    ),
})

export type CreateTransferRequestInput = z.infer<typeof createTransferRequestSchema>

export const approveTransferRequestSchema = z.object({
  requestId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        quantityApproved: z.number().int().min(0, "Cannot be negative"),
      }),
    )
    .min(1),
  note: z.string().max(1000).optional().or(z.literal("")),
})

export type ApproveTransferRequestInput = z.infer<typeof approveTransferRequestSchema>
