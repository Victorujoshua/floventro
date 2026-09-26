"use client"

import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Building2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { payoutAccountSchema, type PayoutAccountInput } from "@/lib/validation/settings"
import { updateOrgPayoutAccountAction } from "@/lib/db/actions/settings"
import type { PayoutAccount } from "@/lib/db/queries/settings"

// ── Org payout form ───────────────────────────────────────────────────────────

function OrgPayoutForm({ current }: { current: PayoutAccount | null }) {
  const router = useRouter()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PayoutAccountInput>({
    resolver: zodResolver(payoutAccountSchema),
    defaultValues: {
      accountName:   current?.accountName   ?? "",
      accountNumber: current?.accountNumber ?? "",
      bankName:      current?.bankName      ?? "",
    },
  })

  async function onSubmit(values: PayoutAccountInput) {
    const result = await updateOrgPayoutAccountAction(values)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success("Organisation account saved")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="org-account-name">Account name</Label>
          <Input
            id="org-account-name"
            placeholder="e.g. Floventro Ltd"
            className="h-9 text-sm"
            {...register("accountName")}
          />
          {errors.accountName && (
            <p className="text-xs text-red-500">{errors.accountName.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-account-number">Account number</Label>
          <Input
            id="org-account-number"
            placeholder="e.g. 0123456789"
            className="h-9 text-sm"
            {...register("accountNumber")}
          />
          {errors.accountNumber && (
            <p className="text-xs text-red-500">{errors.accountNumber.message}</p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="org-bank-name">Bank name</Label>
        <Input
          id="org-bank-name"
          placeholder="e.g. GTBank, Access Bank"
          className="h-9 text-sm"
          {...register("bankName")}
        />
        {errors.bankName && (
          <p className="text-xs text-red-500">{errors.bankName.message}</p>
        )}
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isSubmitting}
          className="bg-violet-700 hover:bg-violet-800 text-white rounded-md h-9 text-sm"
        >
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

type Props = {
  orgPayout: PayoutAccount | null
}

export function OrgSettingsClient({ orgPayout }: Props) {
  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Settings</h1>
        <p className="text-sm text-neutral-500 mt-1">Organisation-wide settings</p>
      </div>

      {/* Org default payout */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-neutral-400" />
          <h2 className="text-base font-semibold text-neutral-950">Payout account</h2>
        </div>
        <p className="text-sm text-neutral-500">
          These details appear on unpaid sales invoices so customers know where to pay.
          Branches can set their own account to override this default.
        </p>
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <OrgPayoutForm current={orgPayout} />
        </div>
      </section>

    </div>
  )
}
