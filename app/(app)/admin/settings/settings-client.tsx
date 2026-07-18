"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Building2, GitBranch, Pencil, CheckCircle2 } from "lucide-react"
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
import { updateOrgPayoutAccountAction, updateBranchPayoutAccountAction } from "@/lib/db/actions/settings"
import type { PayoutAccount, BranchWithPayout } from "@/lib/db/queries/settings"

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
  orgPayout: PayoutAccount | null
  branches:  BranchWithPayout[]
}

export function SettingsClient({ orgPayout, branches }: Props) {
  const router = useRouter()
  const [editBranch, setEditBranch] = useState<BranchWithPayout | null>(null)

  return (
    <div className="max-w-2xl space-y-10">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Settings</h1>
        <p className="text-sm text-neutral-500 mt-1">Manage your organisation's account settings</p>
      </div>

      {/* Org default payout */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-neutral-400" />
          <h2 className="text-base font-semibold text-neutral-950">Payout account — organisation default</h2>
        </div>
        <p className="text-sm text-neutral-500">
          These details appear on unpaid sales invoices so customers know where to pay.
          Branches without an override inherit this account.
        </p>
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <OrgPayoutForm current={orgPayout} />
        </div>
      </section>

      {/* Branch overrides */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-neutral-400" />
          <h2 className="text-base font-semibold text-neutral-950">Branch overrides</h2>
        </div>
        <p className="text-sm text-neutral-500">
          Set a different payout account for a specific branch. Any branch with all fields
          blank falls back to the organisation default.
        </p>

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
