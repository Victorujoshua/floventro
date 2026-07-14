import { z } from "zod"

export const PAYMENT_METHODS = ["bank_transfer", "cash", "cheque", "pos", "other"] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  cash:          "Cash",
  cheque:        "Cheque",
  pos:           "POS",
  other:         "Other",
}

export const paymentSchema = z.object({
  invoiceId:   z.string().uuid(),
  amountNaira: z.number().positive("Amount must be greater than zero"),
  paidOn:      z.string().min(1, "Payment date required"),
  method:      z.enum(PAYMENT_METHODS, { error: "Select a payment method" }),
  reference:   z.string().max(200).optional().or(z.literal("")),
  note:        z.string().max(1000).optional().or(z.literal("")),
})

export type PaymentInput = z.infer<typeof paymentSchema>
