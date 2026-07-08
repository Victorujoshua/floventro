import { z } from "zod"

export const vendorSchema = z.object({
  branchId: z.string().uuid("Please select a branch"),
  name: z.string().min(1, "Name is required").max(200),
  contactPerson: z.string().max(120).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  tin: z.string().max(40).optional().or(z.literal("")),
  cacRegistration: z.string().max(60).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
})

export type VendorInput = z.infer<typeof vendorSchema>
