import { z } from "zod"

export const saleLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  unitPriceNaira: z.number().min(0, "Price must be 0 or more"),
})

// Allows productId: "" for unfilled rows — empty rows are filtered before validation/submit
const saleLineInputSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  unitPriceNaira: z.number().min(0, "Price must be 0 or more"),
})

export const saleServiceLineSchema = z.object({
  serviceTypeId: z.string().uuid("Select a service from the catalog"),
  serviceName: z.string().min(1, "Service name is required").max(200),
  quantity: z.number().int().positive("Quantity must be at least 1"),
  unitPriceNaira: z.number().min(0, "Price must be 0 or more"),
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const saleSchema = z.object({
  clientId: z.string().uuid().optional().or(z.literal("")),
  customerName: z.string().max(120).optional().or(z.literal("")),
  customerPhone: z.string().max(40).optional().or(z.literal("")),
  soldOn: z.string().min(1, "Date is required"),
  note: z.string().max(500).optional().or(z.literal("")),
  paymentMethod: z.enum(["cash", "pos", "bank_transfer", "cheque", "other"]).optional().or(z.literal("")),
  paymentStatus: z.enum(["paid", "unpaid"]),
  vatRate: z.number().min(0, "VAT rate cannot be negative").max(100, "VAT rate cannot exceed 100").optional(),
  lines: z.array(saleLineInputSchema),
  serviceLines: z.array(saleServiceLineSchema),
}).superRefine((data, ctx) => {
  const filledLines = data.lines.filter((l) => l.productId !== "")

  filledLines.forEach((line) => {
    const i = data.lines.indexOf(line)
    if (!UUID_RE.test(line.productId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines", i, "productId"],
        message: "Select a valid product",
      })
    }
  })

  if (filledLines.length === 0 && data.serviceLines.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lines"],
      message: "Add at least one product or service to the sale",
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
