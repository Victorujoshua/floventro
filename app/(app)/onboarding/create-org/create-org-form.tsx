"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createOrgSchema, type CreateOrgInput } from "@/lib/validation/onboarding"
import { createOrgAction } from "@/lib/auth/actions"

export function CreateOrgForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateOrgInput>({
    resolver: zodResolver(createOrgSchema),
    defaultValues: {
      countryCode: "NG",
      currency: "NGN",
      timezone: "Africa/Lagos",
    },
  })

  const onSubmit = async (data: CreateOrgInput) => {
    const result = await createOrgAction(data)

    // createOrgAction calls redirect("/dashboard") on success.
    if (!result.ok) {
      toast.error("Failed to create organisation. Please try again.")
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="name">Organisation name</Label>
        <Input
          id="name"
          type="text"
          autoComplete="organization"
          placeholder="Acme Ltd."
          aria-invalid={!!errors.name}
          {...register("name")}
        />
        {errors.name && (
          <p className="text-xs text-red-600">{errors.name.message}</p>
        )}
      </div>

      <p className="text-xs text-neutral-400">
        Country: Nigeria · Currency: NGN · Timezone: Africa/Lagos
      </p>

      {/* Hidden fields — locked defaults, not user-editable */}
      <input type="hidden" {...register("countryCode")} />
      <input type="hidden" {...register("currency")} />
      <input type="hidden" {...register("timezone")} />

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-2 w-full bg-[#4A02C8] text-white rounded-md h-11 text-sm font-medium hover:bg-[#4A02C8]/90 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isSubmitting ? "Creating…" : "Create organisation"}
      </button>
    </form>
  )
}
