"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { ArrowLeftRight, Plus } from "lucide-react"
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
import { receiveTransferSchema } from "@/lib/validation/transfers"
import type { ReceiveTransferInput } from "@/lib/validation/transfers"
import {
  receiveTransferAction,
  cancelTransferAction,
} from "@/lib/db/actions/transfers"
import type { Transfer, OrgBranch, OrgProduct } from "@/lib/db/queries/transfers"
import type { BranchTransferRequests } from "@/lib/db/queries/transfer-requests"
import { RequestStockDialog, TransferRequestsSection } from "./transfer-requests"

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
          {/* overflow-x-auto: on a narrow screen scroll to the input column rather than clip it */}
          <div className="rounded-lg border border-neutral-200 overflow-x-auto">
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
      {/* Lines table with an input column doesn't fit the default 25vw panel */}
      <DialogContent className="w-[min(480px,100vw)] max-w-lg max-h-[90vh] overflow-y-auto">
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
  requests: BranchTransferRequests
  currentBranchId: string
  currentBranchName: string
  currentUserId: string
  branches: OrgBranch[]
  products: OrgProduct[]
}

// Stock moves between branches only by request → approval (app_0075/0076);
// there is no direct send.
export function TransfersClient({
  transfers,
  requests,
  currentBranchId,
  currentBranchName,
  currentUserId,
  branches,
  products,
}: Props) {
  const router = useRouter()

  const [requestOpen, setRequestOpen] = useState(false)
  const [receiveTarget, setReceiveTarget] = useState<Transfer | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Transfer | null>(null)

  // "Multi-branch" means there are destinations OTHER than the current branch.
  const isMultiBranch = branches.filter((b) => b.id !== currentBranchId).length > 0

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
          onClick={() => setRequestOpen(true)}
          title={isMultiBranch ? undefined : "Add another branch to enable transfers"}
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="h-4 w-4" />
          Request stock
        </button>
      </div>

      {!isMultiBranch && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-tint-amber px-4 py-3 text-sm text-amber-800">
          <strong>Single-branch organisation</strong> — transfers require at least two branches.
          Create a second branch to enable inter-branch stock movements.
        </div>
      )}

      {isMultiBranch && (
        <TransferRequestsSection requests={requests} currentUserId={currentUserId} />
      )}

      <h2 className="text-base font-semibold text-neutral-950 mb-4">Shipments</h2>

      {transfers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center px-6">
          <ArrowLeftRight className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No transfers yet</p>
          <p className="text-sm text-neutral-500 mt-1 max-w-sm">
            Request stock from another branch. Approved requests appear here while in transit.
          </p>
          {isMultiBranch && (
            <button
              onClick={() => setRequestOpen(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Request stock
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
                    {/* Receive belongs to the destination, Cancel to the source —
                        same sides receive_transfer / cancel_transfer enforce. */}
                    {t.status === "in_transit" && (
                      <div className="flex items-center justify-end gap-1.5">
                        {t.destBranchId === currentBranchId && (
                          <button
                            onClick={() => setReceiveTarget(t)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-800 px-3 h-7 text-xs font-medium text-white hover:bg-neutral-900 transition-colors"
                          >
                            Receive
                          </button>
                        )}
                        {t.sourceBranchId === currentBranchId && (
                          <button
                            onClick={() => setCancelTarget(t)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-7 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <RequestStockDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        currentBranchId={currentBranchId}
        currentBranchName={currentBranchName}
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
