"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { GitBranch, Pencil, CheckCircle2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { payoutAccountSchema, type PayoutAccountInput } from "@/lib/validation/settings"
import { updateBranchPayoutAccountAction } from "@/lib/db/actions/settings"
import type { BranchWithPayout } from "@/lib/db/queries/settings"

// ── Branch override panel ─────────────────────────────────────────────────────

function BranchOverridePanel({
  branch,
  onClose,
  onSuccess,
}: {
  branch: BranchWithPayout | null
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
    values: branch
      ? {
          accountName:   branch.payout.accountName   ?? "",
          accountNumber: branch.payout.accountNumber ?? "",
          bankName:      branch.payout.bankName      ?? "",
        }
      : { accountName: "", accountNumber: "", bankName: "" },
  })

  function handleClose() {
    reset()
    onClose()
  }

  async function onSubmit(values: PayoutAccountInput) {
    if (!branch) return
    const result = await updateBranchPayoutAccountAction(branch.id, values)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success(`${branch.name} override saved`)
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={branch !== null} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Payout override — {branch?.name}</DialogTitle>
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
            disabled={isSubmitting || !branch}
            onClick={handleSubmit(onSubmit)}
            className="bg-neutral-800 hover:bg-neutral-900 text-white rounded-md"
          >
            {isSubmitting ? "Saving…" : "Save override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

type Props = {
  branches: BranchWithPayout[]
}

export function SettingsClient({ branches }: Props) {
  const router = useRouter()
  const [editBranch, setEditBranch] = useState<BranchWithPayout | null>(null)

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Branch payout accounts</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Override the organisation&apos;s default payout account for a specific branch.
          Leave blank to use the organisation account.
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-neutral-400" />
          <h2 className="text-base font-semibold text-neutral-950">Branch overrides</h2>
        </div>

        {branches.length === 0 ? (
          <p className="text-sm text-neutral-400">No branches found.</p>
        ) : (
          <div className="rounded-xl border border-neutral-200/60 bg-white overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-neutral-50">
                  <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Branch</TableHead>
                  <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Payout</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((b) => {
                  const hasOverride = !!(b.payout.accountName || b.payout.accountNumber || b.payout.bankName)
                  return (
                    <TableRow key={b.id} className="hover:bg-neutral-50/60 transition-colors">
                      <TableCell className="text-sm font-medium text-neutral-950 py-3.5">
                        {b.name}
                      </TableCell>
                      <TableCell className="py-3.5">
                        {hasOverride ? (
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                            <span className="text-xs text-neutral-600">
                              {[b.payout.bankName, b.payout.accountNumber].filter(Boolean).join(" · ")}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-neutral-400 italic">Inheriting org default</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3.5 text-right">
                        <button
                          onClick={() => setEditBranch(b)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-7 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
                        >
                          <Pencil className="h-3 w-3" />
                          {hasOverride ? "Edit" : "Override"}
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <BranchOverridePanel
        branch={editBranch}
        onClose={() => setEditBranch(null)}
        onSuccess={() => {
          setEditBranch(null)
          router.refresh()
        }}
      />
    </div>
  )
}
