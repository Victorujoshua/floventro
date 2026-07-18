"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { GitBranch, Plus, Pencil } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { branchSchema } from "@/lib/validation/branches"
import type { BranchInput } from "@/lib/validation/branches"
import { createBranchAction, renameBranchAction } from "@/lib/db/actions/branches"
import type { BranchRow } from "@/lib/db/queries/branches"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

// ── Add Branch Dialog ─────────────────────────────────────────────────────────

function AddBranchDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSuccess: () => void
}) {
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BranchInput>({
    resolver: zodResolver(branchSchema),
    defaultValues: { name: "" },
  })

  function handleClose() {
    reset({ name: "" })
    setSubmitError(null)
    onOpenChange(false)
  }

  async function onSubmit(values: BranchInput) {
    setSubmitError(null)
    const result = await createBranchAction(values.name)
    if (!result.ok) {
      setSubmitError(result.message ?? result.error)
      return
    }
    toast.success("Branch created")
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add branch</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="branch-name">Branch name</Label>
            <Input
              id="branch-name"
              placeholder="e.g. Victoria Island, Abuja Central"
              className="h-9 text-sm"
              autoFocus
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-red-500">{errors.name.message}</p>
            )}
          </div>

          {submitError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {submitError}
            </p>
          )}
        </form>

        <DialogFooter showCloseButton>
          <Button
            type="submit"
            form=""
            disabled={isSubmitting}
            onClick={handleSubmit(onSubmit)}
            className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
          >
            {isSubmitting ? "Creating…" : "Create branch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Rename Branch Dialog ──────────────────────────────────────────────────────

function RenameBranchDialog({
  branch,
  onClose,
  onSuccess,
}: {
  branch: BranchRow | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BranchInput>({
    resolver: zodResolver(branchSchema),
    defaultValues: { name: branch?.name ?? "" },
    values: { name: branch?.name ?? "" },
  })

  function handleClose() {
    reset({ name: branch?.name ?? "" })
    setSubmitError(null)
    onClose()
  }

  async function onSubmit(values: BranchInput) {
    if (!branch) return
    setSubmitError(null)
    const result = await renameBranchAction(branch.id, values.name)
    if (!result.ok) {
      setSubmitError(result.message ?? result.error)
      return
    }
    toast.success("Branch renamed")
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={branch !== null} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename branch</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="rename-branch-name">New name</Label>
            <Input
              id="rename-branch-name"
              placeholder="Branch name"
              className="h-9 text-sm"
              autoFocus
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-red-500">{errors.name.message}</p>
            )}
          </div>

          {submitError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {submitError}
            </p>
          )}
        </form>

        <DialogFooter showCloseButton>
          <Button
            type="submit"
            form=""
            disabled={isSubmitting || !branch}
            onClick={handleSubmit(onSubmit)}
            className="bg-neutral-800 hover:bg-neutral-900 text-white rounded-md"
          >
            {isSubmitting ? "Saving…" : "Save name"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

type Props = {
  branches: BranchRow[]
}

export function BranchesClient({ branches }: Props) {
  const router = useRouter()

  const [addOpen, setAddOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<BranchRow | null>(null)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Branches</h1>
          <p className="text-sm text-neutral-500 mt-1">Manage your organisation's locations</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add branch
        </button>
      </div>

      {branches.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center px-6">
          <GitBranch className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No branches found</p>
          <p className="text-sm text-neutral-500 mt-1 max-w-sm">
            Something went wrong — every organisation should have at least one branch.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50">
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Branch name</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Created</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.map((b) => (
                <TableRow key={b.id} className="hover:bg-neutral-50/60 transition-colors">
                  <TableCell className="text-sm font-medium text-neutral-950 py-3.5">
                    {b.name}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-500 py-3.5">
                    {fmtDate(b.createdAt)}
                  </TableCell>
                  <TableCell className="py-3.5 text-right">
                    <button
                      onClick={() => setRenameTarget(b)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-7 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                      Rename
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AddBranchDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={() => router.refresh()}
      />

      <RenameBranchDialog
        branch={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}
