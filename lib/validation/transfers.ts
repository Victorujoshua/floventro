import { z } from "zod"

const transferLineSchema = z.object({
  productId: z.string().uuid("Select a product"),
  quantity: z.number().int().positive("Quantity must be at least 1"),
})

// sourceBranchId is resolved server-side from scope.branchId in initiateTransferAction.
export const initiateTransferSchema = z.object({
  destBranchId: z.string().uuid("Select a destination branch"),
  note: z.string().max(1000).optional().or(z.literal("")),
  lines: z.array(transferLineSchema).min(1, "Add at least one product line"),
})

export type InitiateTransferInput = z.infer<typeof initiateTransferSchema>

const receiveLineSchema = z.object({
  lineId: z.string().uuid(),
  quantityReceived: z.number().int().min(0, "Cannot be negative"),
})

export const receiveTransferSchema = z.object({
  transferId: z.string().uuid(),
  lines: z.array(receiveLineSchema).min(1),
  note: z.string().max(1000).optional().or(z.literal("")),
})

export type ReceiveTransferInput = z.infer<typeof receiveTransferSchema>
