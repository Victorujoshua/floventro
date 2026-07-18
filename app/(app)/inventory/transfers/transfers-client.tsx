"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { ArrowLeftRight, Plus, Trash2 } from "lucide-react"
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
import { initiateTransferSchema, receiveTransferSchema } from "@/lib/validation/transfers"
import type { InitiateTransferInput, ReceiveTransferInput } from "@/lib/validation/transfers"
import {
  initiateTransferAction,
  receiveTransferAction,
  cancelTransferAction,
} from "@/lib/db/actions/transfers"
import type { Transfer, OrgBranch, OrgProduct } from "@/lib/db/queries/transfers"

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase()
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    in_transit: { label: "In transit", className: "bg-tint-amber text-amber-700" },
    received:   { label: "Received",   className: "bg-tint-success text-green-700" },
    cancelled:  { label: "Cancelled",  className: "bg-neutral-100 text-neutral-500" },
  }
  const entry = map[status] ?? { label: status, className: "bg-neutral-100 text-neutral-500" }
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${entry.className}`}>
      {entry.label}
    </span>
  )
}

// ── Initiate Transfer Dialog ──────────────────────────────────────────────────

function InitiateTransferDialog({
  open,
  onOpenChange,
  branches,
  products,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  branches: OrgBranch[]
  products: OrgProduct[]
  onSuccess: () => void
}) {
  const [submitError, setSubmitError] = useState<string | null>(null)

  const defaultValues: InitiateTransferInput = {
    sourceBranchId: branches[0]?.id ?? "",
    destBranchId: branches[1]?.id ?? "",
    note: "",
    lines: [{ productId: "", quantity: 1 }],
  }

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InitiateTransferInput>({
    resolver: zodResolver(initiateTransferSchema),
    defaultValues,
  })

  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  const sourceBranchId = watch("sourceBranchId")
  const destOptions = branches.filter((b) => b.id !== sourceBranchId)

  function handleClose() {
    reset(defaultValues)
    setSubmitError(null)
    onOpenChange(false)
  }

  async function onSubmit(values: InitiateTransferInput) {
    setSubmitError(null)
    const result = await initiateTransferAction(values)
    if (!result.ok) {
      setSubmitError(result.message ?? result.error)
      return
    }
    toast.success("Transfer initiated")
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New transfer</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-1">
          {/* Route */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>From (source)</Label>
              <select
                className="w-full rounded-md border border-neutral-300 bg-white px-3 h-9 text-sm text-neutral-950 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700"
                {...register("sourceBranchId")}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              {errors.sourceBranchId && (
                <p className="text-xs text-red-500">{errors.sourceBranchId.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>To (destination)</Label>
              <select
                className="w-full rounded-md border border-neutral-300 bg-white px-3 h-9 text-sm text-neutral-950 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700"
                {...register("destBranchId")}
              >
                <option value="">Select branch…</option>
                {destOptions.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              {errors.destBranchId && (
                <p className="text-xs text-red-500">{errors.destBranchId.message}</p>
              )}
            </div>
          </div>

          {/* Lines */}
          <div className="space-y-2">
            <Label>Products</Label>
            {fields.map((field, index) => (
              <div key={field.id} className="flex gap-2 items-start">
                <div className="flex-1">
                  <select
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 h-9 text-sm text-neutral-950 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700"
                    {...register(`lines.${index}.productId`)}
                  >
                    <option value="">Select product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                  {errors.lines?.[index]?.productId && (
                    <p className="text-xs text-red-500 mt-0.5">
                      {errors.lines[index]!.productId?.message}
                    </p>
                  )}
                </div>
                <div className="w-24 shrink-0">
                  <Input
                    type="number"
                    min={1}
                    placeholder="Qty"
                    className="h-9 text-sm tabular-nums"
                    {...register(`lines.${index}.quantity`, { valueAsNumber: true })}
                  />
                  {errors.lines?.[index]?.quantity && (
                    <p className="text-xs text-red-500 mt-0.5">
                      {errors.lines[index]!.quantity?.message}
                    </p>
                  )}
                </div>
                {fields.length > 1 && (
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-400 hover:bg-neutral-50 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {(errors.lines?.message || errors.lines?.root?.message) && (
              <p className="text-xs text-red-500">
                {errors.lines?.message ?? errors.lines?.root?.message}
              </p>
            )}
            <button
              type="button"
              onClick={() => append({ productId: "", quantity: 1 })}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-800 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add product
            </button>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label>
              Note{" "}
              <span className="text-neutral-400 font-normal">(optional)</span>
            </Label>
            <textarea
              rows={2}
              placeholder="e.g. weekly replenishment, urgent restock"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
              {...register("note")}
            />
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
            {isSubmitting ? "Initiating…" : "Initiate transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Receive Transfer Form (inner, keyed per transfer) ─────────────────────────

function ReceiveTransferForm({
  transfer,
  onClose,
  onSuccess,
}: {
  transfer: Transfer
  onClose: () => void
  onSuccess: () => void
}) {
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ReceiveTransferInput>({
    resolver: zodResolver(receiveTransferSchema),
    defaultValues: {
      transferId: transfer.id,
      lines: transfer.lines.map((l) => ({
        lineId: l.id,
        quantityReceived: l.quantitySent,
      })),
      note: "",
    },
  })

  async function onSubmit(values: ReceiveTransferInput) {
    setSubmitError(null)
    const result = await receiveTransferAction(values)
    if (!result.ok) {
      setSubmitError(result.message ?? result.error)
      return
    }
    toast.success("Transfer received")
    onClose()
    onSuccess()
  }

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-1">
        {/* Transfer summary */}
        <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 space-y-1">
          <p className="text-xs font-mono text-neutral-400">{shortId(transfer.id)}</p>
          <p className="text-sm font-medium text-neutral-950">
            {transfer.sourceBranchName} → {transfer.destBranchName}
          </p>
          {transfer.note && (
            <p className="text-xs text-neutral-500 mt-1">{transfer.note}</p>
          )}
        </div>

        {/* Hidden transferId */}
        <input type="hidden" {...register("transferId")} />

        {/* Lines */}
        <div className="space-y-2">
          <Label>Quantities received</Label>
          <p className="text-xs text-neutral-500">
            Default is full quantity. Lower any value if units were damaged or lost in transit.
          </p>
          <div className="rounded-lg border border-neutral-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200">
                  <th className="px-3 py-2 text-left text-xs font-medium text-neutral-500 w-full">Product</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-neutral-500 whitespace-nowrap">Sent</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-neutral-500 whitespace-nowrap">Received</th>
                </tr>
              </thead>
              <tbody>
                {transfer.lines.map((line, index) => (
                  <tr key={line.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-neutral-950">{line.productName}</p>
                      <p className="text-xs font-mono text-neutral-400">{line.productSku}</p>
                      <input type="hidden" {...register(`lines.${index}.lineId`)} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-neutral-500">
                      {line.quantitySent}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Input
                        type="number"
                        min={0}
                        max={line.quantitySent}
                        className="h-8 w-20 text-sm tabular-nums text-right ml-auto"
                        {...register(`lines.${index}.quantityReceived`, { valueAsNumber: true })}
                      />
                      {errors.lines?.[index]?.quantityReceived && (
                        <p className="text-xs text-red-500 mt-0.5 text-right">
                          {errors.lines[index]!.quantityReceived?.message}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Note */}
        <div className="space-y-1.5">
          <Label>
            Note{" "}
            <span className="text-neutral-400 font-normal">(optional)</span>
          </Label>
          <textarea
            rows={2}
            placeholder="e.g. 2 units arrived damaged"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
            {...register("note")}
          />
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
          className="bg-neutral-800 hover:bg-neutral-900 text-white rounded-md"
        >
          {isSubmitting ? "Saving…" : "Mark as received"}
        </Button>
      </DialogFooter>
    </>
  )
}

function ReceiveTransferDialog({
  transfer,
  onClose,
  onSuccess,
}: {
  transfer: Transfer | null
  onClose: () => void
  onSuccess: () => void
}) {
  return (
    <Dialog open={transfer !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive transfer</DialogTitle>
        </DialogHeader>
        {transfer && (
          <ReceiveTransferForm
            key={transfer.id}
            transfer={transfer}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Cancel Transfer Dialog ────────────────────────────────────────────────────

function CancelTransferDialog({
  transfer,
  onClose,
  onSuccess,
}: {
  transfer: Transfer | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [note, setNote] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function handleClose() {
    setNote("")
    setSubmitError(null)
    onClose()
  }

  async function handleCancel() {
    if (!transfer) return
    setSubmitError(null)
    setIsSubmitting(true)
    try {
      const result = await cancelTransferAction(transfer.id, note || undefined)
      if (!result.ok) {
        setSubmitError(result.message ?? result.error)
        return
      }
      toast.success("Transfer cancelled — stock credited back to source branch")
      handleClose()
      onSuccess()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={transfer !== null} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel transfer</DialogTitle>
        </DialogHeader>

        {transfer && (
          <div className="space-y-4 pt-1">
            <p className="text-sm text-neutral-700">
              This will cancel transfer{" "}
              <span className="font-mono font-medium">{shortId(transfer.id)}</span>{" "}
              from <strong>{transfer.sourceBranchName}</strong> to{" "}
              <strong>{transfer.destBranchName}</strong>. All sent stock will be credited
              back to the source branch.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="cancel-note">
                Reason{" "}
                <span className="text-neutral-400 font-normal">(optional)</span>
              </Label>
              <textarea
                id="cancel-note"
                rows={2}
                placeholder="e.g. wrong branch selected, stock recalled"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none"
              />
            </div>

            {submitError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                {submitError}
              </p>
            )}
          </div>
        )}

        <DialogFooter showCloseButton>
          <Button
            disabled={isSubmitting || !transfer}
            onClick={handleCancel}
            className="bg-red-600 hover:bg-red-700 text-white rounded-md"
          >
            {isSubmitting ? "Cancelling…" : "Cancel transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

type Props = {
  transfers: Transfer[]
  branches: OrgBranch[]
  products: OrgProduct[]
}

export function TransfersClient({ transfers, branches, products }: Props) {
  const router = useRouter()

  const [initiateOpen, setInitiateOpen] = useState(false)
  const [receiveTarget, setReceiveTarget] = useState<Transfer | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Transfer | null>(null)

  const isMultiBranch = branches.length > 1

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Transfers</h1>
          <p className="text-sm text-neutral-500 mt-1">Move stock between branches in your organisation</p>
        </div>
        <button
          disabled={!isMultiBranch}
          onClick={() => setInitiateOpen(true)}
          title={isMultiBranch ? undefined : "Add another branch to enable transfers"}
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="h-4 w-4" />
          New transfer
        </button>
      </div>

      {!isMultiBranch && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-tint-amber px-4 py-3 text-sm text-amber-800">
          <strong>Single-branch organisation</strong> — transfers require at least two branches.
          Create a second branch to enable inter-branch stock movements.
        </div>
      )}

      {transfers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center px-6">
          <ArrowLeftRight className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No transfers yet</p>
          <p className="text-sm text-neutral-500 mt-1 max-w-sm">
            Initiate a transfer to move stock from one branch to another.
          </p>
          {isMultiBranch && (
            <button
              onClick={() => setInitiateOpen(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
            >
              <Plus className="h-4 w-4" />
              New transfer
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50">
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide w-28">ID</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Route</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Products</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Status</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Date</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.map((t) => (
                <TableRow key={t.id} className="hover:bg-neutral-50/60 transition-colors">
                  <TableCell className="font-mono text-xs tabular-nums text-neutral-400 py-3.5">
                    {shortId(t.id)}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-950 py-3.5">
                    <span className="font-medium">{t.sourceBranchName}</span>
                    <span className="mx-1.5 text-neutral-400">→</span>
                    <span className="font-medium">{t.destBranchName}</span>
                  </TableCell>
                  <TableCell className="text-sm text-neutral-600 py-3.5">
                    {t.lines.length === 1
                      ? t.lines[0].productName
                      : `${t.lines.length} products`}
                  </TableCell>
                  <TableCell className="py-3.5">
                    <StatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="text-sm text-neutral-500 py-3.5 whitespace-nowrap">
                    {fmtDate(t.initiatedAt)}
                  </TableCell>
                  <TableCell className="py-3.5 text-right">
                    {t.status === "in_transit" && (
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setReceiveTarget(t)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 h-7 text-xs font-medium text-white hover:bg-neutral-900 transition-colors"
                        >
                          Receive
                        </button>
                        <button
                          onClick={() => setCancelTarget(t)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-7 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <InitiateTransferDialog
        open={initiateOpen}
        onOpenChange={setInitiateOpen}
        branches={branches}
        products={products}
        onSuccess={() => router.refresh()}
      />

      <ReceiveTransferDialog
        transfer={receiveTarget}
        onClose={() => setReceiveTarget(null)}
        onSuccess={() => router.refresh()}
      />

      <CancelTransferDialog
        transfer={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}
