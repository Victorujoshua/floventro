"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { CheckCircle2, Pencil } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { payoutAccountSchema, type PayoutAccountInput } from "@/lib/validation/settings"
import { updateBranchPayoutAccountAction } from "@/lib/db/actions/settings"
import type { BranchWithPayout } from "@/lib/db/queries/settings"

// ── Edit dialog ───────────────────────────────────────────────────────────────

function EditPayoutDialog({
  branch,
  open,
  onClose,
  onSuccess,
}: {
  branch: BranchWithPayout
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PayoutAccountInput>({
    resolver: zodResolver(payoutAccountSchema),
    values: {
      accountName:   branch.payout.accountName   ?? "",
      accountNumber: branch.payout.accountNumber ?? "",
      bankName:      branch.payout.bankName      ?? "",
    },
  })

  function handleClose() {
    reset()
    onClose()
  }

  async function onSubmit(values: PayoutAccountInput) {
    const result = await updateBranchPayoutAccountAction(branch.id, values)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success("Branch account saved")
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Payout account — {branch.name}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-neutral-500">
          Leave all fields blank to inherit the organisation default.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="br-account-name">Account name</Label>
            <Input
              id="br-account-name"
              placeholder="Leave blank to inherit"
              className="h-9 text-sm"
              {...register("accountName")}
            />
            {errors.accountName && (
              <p className="text-xs text-red-500">{errors.accountName.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-account-number">Account number</Label>
            <Input
              id="br-account-number"
              placeholder="Leave blank to inherit"
              className="h-9 text-sm"
              {...register("accountNumber")}
            />
            {errors.accountNumber && (
              <p className="text-xs text-red-500">{errors.accountNumber.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="br-bank-name">Bank name</Label>
            <Input
              id="br-bank-name"
              placeholder="Leave blank to inherit"
              className="h-9 text-sm"
              {...register("bankName")}
            />
            {errors.bankName && (
              <p className="text-xs text-red-500">{errors.bankName.message}</p>
            )}
          </div>
        </form>

        <DialogFooter showCloseButton>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={handleSubmit(onSubmit)}
            className="bg-neutral-800 hover:bg-neutral-900 text-white rounded-md"
          >
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

type Props = {
  branch: BranchWithPayout
}

export function SettingsClient({ branch }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  const { accountName, accountNumber, bankName } = branch.payout
  const hasOverride = !!(accountName || accountNumber || bankName)

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">
          {branch.name} payout account
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Override the organisation&apos;s default payout account for this branch.
          Leave blank to use the organisation account.
        </p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-5 flex items-start justify-between gap-4">
        <div>
          {hasOverride ? (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <span className="text-sm font-medium text-neutral-950">
                  {accountName}
                </span>
              </div>
              <p className="text-sm text-neutral-500 pl-5.5">
                {[bankName, accountNumber].filter(Boolean).join(" · ")}
              </p>
            </div>
          ) : (
            <p className="text-sm text-neutral-400 italic">
              Inheriting organisation default
            </p>
          )}
        </div>

        <button
          onClick={() => setEditing(true)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          <Pencil className="h-3 w-3" />
          {hasOverride ? "Edit" : "Override"}
        </button>
      </div>

      <EditPayoutDialog
        branch={branch}
        open={editing}
        onClose={() => setEditing(false)}
        onSuccess={() => {
          setEditing(false)
          router.refresh()
        }}
      />
    </div>
  )
}
