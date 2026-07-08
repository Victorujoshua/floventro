import { z } from "zod"

export const invoiceLineSchema = z.object({
  productId: z.string().uuid("Select a product"),
  quantity: z.number().int().positive("Qty must be greater than 0"),
  unitCostNaira: z.number().nonnegative("Cost cannot be negative"),
})

export const invoiceSchema = z.object({
  branchId: z.string().uuid().optional(),
  vendorId: z.string().uuid("Select a vendor"),
  invoiceNumber: z.string().max(80).optional().or(z.literal("")),
  invoiceDate: z.string().min(1, "Invoice date required"),
  dueDate: z.string().optional().or(z.literal("")),
  note: z.string().max(1000).optional().or(z.literal("")),
  lines: z.array(invoiceLineSchema).min(1, "Add at least one product line"),
})

export type InvoiceInput = z.infer<typeof invoiceSchema>
