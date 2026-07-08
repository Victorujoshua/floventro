"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { vendorSchema, type VendorInput } from "@/lib/validation/vendors"
import { createVendorAction, updateVendorAction } from "@/lib/db/actions/vendors"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

type Branch = {
  id: string
  name: string
}

type Props = {
  mode: "create" | "edit"
  branches: Branch[]
  initialData?: VendorInput & { id: string }
  onSuccess: () => void
}

export function VendorForm({ mode, branches, initialData, onSuccess }: Props) {
  const defaultBranchId = branches.length === 1 ? branches[0].id : (initialData?.branchId ?? "")

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<VendorInput>({
    resolver: zodResolver(vendorSchema),
    defaultValues: initialData
      ? {
          branchId: initialData.branchId,
          name: initialData.name,
          contactPerson: initialData.contactPerson ?? "",
          phone: initialData.phone ?? "",
          email: initialData.email ?? "",
          tin: initialData.tin ?? "",
          cacRegistration: initialData.cacRegistration ?? "",
          notes: initialData.notes ?? "",
        }
      : {
          branchId: defaultBranchId,
          name: "",
          contactPerson: "",
          phone: "",
          email: "",
          tin: "",
          cacRegistration: "",
          notes: "",
        },
  })

  const onSubmit = async (values: VendorInput) => {
    const result =
      mode === "create"
        ? await createVendorAction(values)
        : await updateVendorAction(initialData!.id, values)

    if (!result.ok) {
      if (result.code === "name_taken" || result.error === "name_taken") {
        setError("name", { message: "A vendor with this name already exists in this branch" })
      } else if (result.code === "not_allowed" || result.error === "not_allowed") {
        toast.error("You don't have permission to perform this action.")
      } else {
        toast.error(result.error)
      }
      return
    }

    toast.success(mode === "create" ? "Vendor created" : "Vendor updated")
    onSuccess()
  }

  const showBranchSelector = mode === "create" && branches.length > 1

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Branch selector — shown on create when org has multiple branches */}
      {showBranchSelector && (
        <div className="space-y-1.5">
          <Label htmlFor="branchId">Branch</Label>
          <select
            id="branchId"
            {...register("branchId")}
            className="flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 shadow-xs transition-colors focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Select a branch…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {errors.branchId && (
            <p className="text-xs text-red-500">{errors.branchId.message}</p>
          )}
        </div>
      )}

      {/* Hidden branchId for single-branch or edit mode */}
      {!showBranchSelector && <input type="hidden" {...register("branchId")} />}

      {/* Name — full width */}
      <div className="space-y-1.5">
        <Label htmlFor="name">
          Name <span className="text-red-500">*</span>
        </Label>
        <Input id="name" placeholder="Vendor name" {...register("name")} />
        {errors.name && (
          <p className="text-xs text-red-500">{errors.name.message}</p>
        )}
      </div>

      {/* 2-column grid for short fields */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="contactPerson">Contact person</Label>
          <Input id="contactPerson" placeholder="e.g. Amina Bello" {...register("contactPerson")} />
          {errors.contactPerson && (
            <p className="text-xs text-red-500">{errors.contactPerson.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" placeholder="e.g. +234 800 000 0000" {...register("phone")} />
          {errors.phone && (
            <p className="text-xs text-red-500">{errors.phone.message}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" placeholder="vendor@example.com" {...register("email")} />
          {errors.email && (
            <p className="text-xs text-red-500">{errors.email.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tin">TIN</Label>
          <Input id="tin" placeholder="Tax Identification Number" {...register("tin")} />
          {errors.tin && (
            <p className="text-xs text-red-500">{errors.tin.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cacRegistration">CAC registration</Label>
        <Input
          id="cacRegistration"
          placeholder="Corporate Affairs Commission number"
          {...register("cacRegistration")}
        />
        {errors.cacRegistration && (
          <p className="text-xs text-red-500">{errors.cacRegistration.message}</p>
        )}
      </div>

      {/* Notes — full width */}
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          placeholder="Optional notes about this vendor"
          rows={3}
          {...register("notes")}
        />
        {errors.notes && (
          <p className="text-xs text-red-500">{errors.notes.message}</p>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          disabled={isSubmitting}
          className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
        >
          {isSubmitting ? "Saving…" : "Save vendor"}
        </Button>
      </div>
    </form>
  )
}
