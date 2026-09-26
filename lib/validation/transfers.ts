import { z } from "zod"

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
