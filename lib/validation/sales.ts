import { z } from "zod"

export const saleLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  unitPriceNaira: z.number().min(0, "Price must be 0 or more"),
})

export const saleServiceLineSchema = z.object({
  serviceTypeId: z.string().uuid("Select a service from the catalog"),
  serviceName: z.string().min(1, "Service name is required").max(200),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  unitPriceNaira: z.number().min(0, "Price must be 0 or more"),
})

export const saleSchema = z.object({
  customerName: z.string().max(120).optional().or(z.literal("")),
  customerPhone: z.string().max(40).optional().or(z.literal("")),
  soldOn: z.string().min(1, "Date is required"),
  note: z.string().max(500).optional().or(z.literal("")),
  paymentMethod: z.enum(["cash", "pos", "bank_transfer", "cheque", "other"]).optional().or(z.literal("")),
  paymentStatus: z.enum(["paid", "unpaid"]),
  vatRate: z.number().min(0, "VAT rate cannot be negative").max(100, "VAT rate cannot exceed 100").optional(),
  lines: z.array(saleLineSchema),
  serviceLines: z.array(saleServiceLineSchema),
}).superRefine((data, ctx) => {
  if (data.lines.length === 0 && data.serviceLines.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lines"],
      message: "Add at least one product or service",
    })
  }
  if (data.paymentStatus === "paid" && !data.paymentMethod) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["paymentMethod"],
      message: "Select how the sale was paid",
    })
  }
})

export const salePaymentSchema = z.object({
  amountNaira: z.number().positive("Amount must be greater than zero"),
  paidOn: z.string().min(1, "Date is required"),
  method: z.enum(["cash", "pos", "bank_transfer", "cheque", "other"]).optional(),
  note: z.string().max(500).optional().or(z.literal("")),
})

export type SaleLine = z.infer<typeof saleLineSchema>
export type SaleServiceLine = z.infer<typeof saleServiceLineSchema>

export type SaleInput = z.infer<typeof saleSchema>
export type SalePaymentInput = z.infer<typeof salePaymentSchema>
