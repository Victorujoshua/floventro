"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2, Inbox } from "lucide-react"
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
import {
  createTransferRequestAction,
  approveTransferRequestAction,
  rejectTransferRequestAction,
  cancelTransferRequestAction,
  getBranchAvailableStockAction,
} from "@/lib/db/actions/transfer-requests"
import type { OrgBranch, OrgProduct } from "@/lib/db/queries/transfers"
import type { BranchTransferRequests, TransferRequest } from "@/lib/db/queries/transfer-requests"

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

// Free typing in quantity boxes; clamp only when used (blur / submit).
function clampQty(raw: string, max: number) {
  const n = parseInt(raw, 10)
  if (isNaN(n)) return 0
  return Math.max(0, Math.min(max, n))
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:            { label: "Pending",   className: "bg-tint-amber text-amber-700" },
  approved:           { label: "Approved",  className: "bg-tint-success text-green-700" },
  partially_approved: { label: "Partial",   className: "bg-tint-amber text-amber-700" },
  rejected:           { label: "Rejected",  className: "bg-tint-coral text-red-700" },
  cancelled:          { label: "Cancelled", className: "bg-neutral-100 text-neutral-600" },
}

function RequestStatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, className: "bg-neutral-100 text-neutral-600" }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  )
}

const SELECT_CLASS =
  "w-full rounded-md border border-neutral-300 bg-white px-3 h-9 text-sm text-neutral-950 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700"

// ── Request stock dialog (destination branch) ─────────────────────────────────

type DraftLine = { key: number; productId: string; quantity: string }

export function RequestStockDialog({
  open,
  onOpenChange,
  currentBranchId,
  currentBranchName,
  branches,
  products,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  currentBranchId: string
  currentBranchName: string
  branches: OrgBranch[]
  products: OrgProduct[]
  onSuccess: () => void
}) {
  const sourceOptions = branches.filter((b) => b.id !== currentBranchId)

  const [sourceBranchId, setSourceBranchId] = useState("")
  const [lines, setLines] = useState<DraftLine[]>([{ key: 0, productId: "", quantity: "1" }])
  const [nextKey, setNextKey] = useState(1)
  const [note, setNote] = useState("")
  // Stock at the selected source branch: null = not loaded
  const [sourceStock, setSourceStock] = useState<Record<string, number> | null>(null)
  const [stockLoading, setStockLoading] = useState(false)
  const [stockError, setStockError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const sourceName = sourceOptions.find((b) => b.id === sourceBranchId)?.name ?? ""

  function reset() {
    setSourceBranchId("")
    setLines([{ key: 0, productId: "", quantity: "1" }])
    setNextKey(1)
    setNote("")
    setSourceStock(null)
    setStockError(null)
    setSubmitError(null)
  }

  function handleClose() {
    reset()
    onOpenChange(false)
  }

  async function selectSource(id: string) {
    setSourceBranchId(id)
    setSourceStock(null)
    setStockError(null)
    if (!id) return
    setStockLoading(true)
    const result = await getBranchAvailableStockAction(id)
    setStockLoading(false)
    if (result.ok) setSourceStock(result.data)
    else setStockError(result.message ?? "Couldn't load stock for that branch.")
  }

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function handleSubmit() {
    setSubmitError(null)
    if (!sourceBranchId) {
      setSubmitError("Select the branch to request from.")
      return
    }
    const parsed = lines.map((l) => ({ productId: l.productId, quantity: parseInt(l.quantity, 10) }))
    if (parsed.some((l) => !l.productId)) {
      setSubmitError("Select a product on every line.")
      return
    }
    if (parsed.some((l) => isNaN(l.quantity) || l.quantity < 1)) {
      setSubmitError("Every quantity must be at least 1.")
      return
    }
    if (new Set(parsed.map((l) => l.productId)).size !== parsed.length) {
      setSubmitError("Each product can only be listed once.")
      return
    }

    setSubmitting(true)
    const result = await createTransferRequestAction({ sourceBranchId, note, lines: parsed })
    setSubmitting(false)
    if (!result.ok) {
      setSubmitError(result.message ?? result.error)
      return
    }
    toast.success(`Request sent to ${sourceName}`)
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="w-[min(480px,100vw)] max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request stock</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="request-source">From</Label>
              <select
                id="request-source"
                value={sourceBranchId}
                onChange={(e) => selectSource(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">Select branch…</option>
                {sourceOptions.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>To (this branch)</Label>
              <div className="flex items-center h-9 rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-700 font-medium">
                {currentBranchName}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Products</Label>
            {stockLoading && <p className="text-xs text-neutral-500">Loading {sourceName} stock…</p>}
            {stockError && <p className="text-xs text-red-600">{stockError}</p>}
            {lines.map((line) => {
              const available = sourceStock && line.productId ? (sourceStock[line.productId] ?? 0) : null
              const qty = parseInt(line.quantity, 10)
              const overAvailable = available !== null && !isNaN(qty) && qty > available
              return (
                <div key={line.key} className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0">
                    <select
                      aria-label="Product"
                      value={line.productId}
                      onChange={(e) => updateLine(line.key, { productId: e.target.value })}
                      className={SELECT_CLASS}
                    >
                      <option value="">Select product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku})
                        </option>
                      ))}
                    </select>
                    {available !== null && (
                      <p className={`text-xs mt-1 ${overAvailable || available === 0 ? "text-amber-700" : "text-neutral-500"}`}>
                        {sourceName} has <span className="font-medium tabular-nums">{available}</span> in stock
                        {overAvailable ? " — they may approve less" : ""}
                      </p>
                    )}
                  </div>
                  <div className="w-24 shrink-0">
                    <Input
                      type="number"
                      min={1}
                      aria-label="Quantity"
                      value={line.quantity}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      className="h-9 text-sm tabular-nums"
                    />
                  </div>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove line"
                      onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 text-neutral-400 hover:bg-neutral-50 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => {
                setLines((prev) => [...prev, { key: nextKey, productId: "", quantity: "1" }])
                setNextKey((k) => k + 1)
              }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-800 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add product
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="request-note">
              Note <span className="text-neutral-400 font-normal">(optional)</span>
            </Label>
            <textarea
              id="request-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. running low before the weekend"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
            />
          </div>

          {submitError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {submitError}
            </p>
          )}
        </div>

        <DialogFooter showCloseButton>
          <Button
            disabled={submitting}
            onClick={handleSubmit}
            className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
          >
            {submitting ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Incoming request review card (source branch) ─────────────────────────────

function IncomingRequestCard({ request }: { request: TransferRequest }) {
  const router = useRouter()
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const line of request.lines) {
      init[line.id] = String(Math.min(line.quantityRequested, line.inStock ?? 0))
    }
    return init
  })
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const approved = (lineId: string, max: number) => clampQty(qtyInputs[lineId] ?? "", max)

  async function handleDecision(decision: "approve" | "reject") {
    setError(null)

    if (decision === "reject" && !note.trim()) {
      setError("A note is required when rejecting — tell the requesting branch why.")
      return
    }

    const lines = request.lines.map((l) => ({
      lineId: l.id,
      quantityApproved: approved(l.id, l.quantityRequested),
    }))

    if (decision === "approve") {
      const isPartial = lines.some((l, i) => l.quantityApproved < request.lines[i].quantityRequested)
      if (isPartial && !note.trim()) {
        setError("A note is required when approving partial quantities — explain the shortfall.")
        return
      }
    }

    setSubmitting(true)
    const result =
      decision === "approve"
        ? await approveTransferRequestAction({ requestId: request.id, lines, note })
        : await rejectTransferRequestAction(request.id, note)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }

    toast.success(
      decision === "reject"
        ? "Request rejected"
        : lines.every((l) => l.quantityApproved === 0)
          ? "Nothing approved — request rejected"
          : `Approved — stock is in transit to ${request.destBranchName}`,
    )
    router.refresh()
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200/60 overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-950">
            {request.destBranchName}
            <span className="font-normal text-neutral-500"> is requesting stock</span>
          </p>
          <p className="text-xs text-neutral-500">{request.requesterLabel}</p>
          {request.note && (
            <p className="mt-1 text-xs text-neutral-600 italic">&ldquo;{request.note}&rdquo;</p>
          )}
        </div>
        <p className="text-xs text-neutral-400 shrink-0">{formatDate(request.createdAt)}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50">
              <th className="px-5 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">Product</th>
              <th className="px-5 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide">Requested</th>
              <th className="px-5 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide">In stock</th>
              <th className="px-5 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide w-36">Approve qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {request.lines.map((line) => {
              const inStock = line.inStock ?? 0
              const isLow = inStock < line.quantityRequested
              return (
                <tr key={line.id} className={isLow ? "bg-amber-50/40" : "hover:bg-neutral-50/60 transition-colors"}>
                  <td className="px-5 py-3.5">
                    <span className="font-medium text-neutral-950">{line.productName}</span>
                    {line.productSku && (
                      <span className="ml-1.5 text-xs text-neutral-400 font-mono">{line.productSku}</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">{line.quantityRequested}</td>
                  <td className={`px-5 py-3.5 text-right tabular-nums font-medium ${isLow ? "text-amber-600" : "text-neutral-700"}`}>
                    {inStock}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <input
                      type="number"
                      min={0}
                      max={line.quantityRequested}
                      aria-label={`Approve quantity for ${line.productName}`}
                      value={qtyInputs[line.id] ?? ""}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setQtyInputs((prev) => ({ ...prev, [line.id]: e.target.value }))}
                      onBlur={() =>
                        setQtyInputs((prev) => ({
                          ...prev,
                          [line.id]: String(approved(line.id, line.quantityRequested)),
                        }))
                      }
                      className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-right tabular-nums text-neutral-950 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-4 border-t border-neutral-100 space-y-3">
        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</p>
        )}
        <div className="space-y-1">
          <label htmlFor={`review-note-${request.id}`} className="text-xs font-medium text-neutral-700">
            Note to {request.destBranchName}
            <span className="ml-1 font-normal text-neutral-400">
              — required when rejecting or approving partial quantities
            </span>
          </label>
          <textarea
            id={`review-note-${request.id}`}
            placeholder="They'll see this with the decision."
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
          />
        </div>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={() => handleDecision("reject")}
            disabled={submitting}
            className="inline-flex items-center rounded-md border border-neutral-200 px-4 h-9 text-sm font-medium text-neutral-700 hover:bg-neutral-50 hover:border-neutral-300 transition-colors disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={() => handleDecision("approve")}
            disabled={submitting}
            className="inline-flex items-center rounded-md bg-violet-700 px-4 h-9 text-sm font-medium text-white hover:bg-violet-800 transition-colors disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Approve & send"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Compact card: reviewed incoming, and every outgoing request ───────────────

function RequestSummaryCard({
  request,
  direction,
  canCancel,
}: {
  request: TransferRequest
  direction: "incoming" | "outgoing"
  canCancel: boolean
}) {
  const router = useRouter()
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCancel() {
    setError(null)
    setCancelling(true)
    const result = await cancelTransferRequestAction(request.id)
    setCancelling(false)
    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }
    toast.success("Request cancelled")
    router.refresh()
  }

  const counterpart =
    direction === "outgoing" ? `From ${request.sourceBranchName}` : `For ${request.destBranchName}`

  return (
    <div className="bg-white rounded-2xl border border-neutral-200/60 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-neutral-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <RequestStatusBadge status={request.status} />
          <span className="text-sm font-medium text-neutral-950 truncate">{counterpart}</span>
          <span className="text-xs text-neutral-500 truncate hidden sm:inline">{request.requesterLabel}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-neutral-400">{formatDate(request.createdAt)}</span>
          {canCancel && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="inline-flex items-center rounded-md border border-neutral-200 px-3 h-7 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Cancel request"}
            </button>
          )}
        </div>
      </div>

      <table className="w-full text-sm">
        <tbody className="divide-y divide-neutral-100">
          {request.lines.map((line) => {
            const isShort = line.quantityApproved !== null && line.quantityApproved < line.quantityRequested
            return (
              <tr key={line.id}>
                <td className="px-5 py-2.5">
                  <span className="text-neutral-950">{line.productName}</span>
                  {line.productSku && (
                    <span className="ml-1.5 text-xs text-neutral-400 font-mono">{line.productSku}</span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums text-neutral-500 text-xs whitespace-nowrap">
                  req {line.quantityRequested}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {line.quantityApproved === null ? (
                    <span className="text-neutral-400 text-xs">—</span>
                  ) : isShort ? (
                    <span className={`text-xs ${line.quantityApproved === 0 ? "text-red-600" : "text-amber-600"}`}>
                      {line.quantityApproved} of {line.quantityRequested}
                    </span>
                  ) : (
                    <span className="text-xs text-green-700">{line.quantityApproved}</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {(request.reviewedAt || request.reviewNote || request.transferId || error) && (
        <div className="px-5 py-3 border-t border-neutral-100 space-y-2">
          {request.reviewedAt && (
            <p className="text-xs text-neutral-500">
              Reviewed{request.reviewerLabel ? <> by <span className="font-medium text-neutral-700">{request.reviewerLabel}</span></> : null}
              {" · "}{formatDate(request.reviewedAt)}
              {request.transferId && <> · sent as transfer <span className="font-mono">{request.transferId.slice(0, 8).toUpperCase()}</span></>}
            </p>
          )}
          {request.reviewNote && (
            <blockquote className="rounded-lg px-3 py-2 text-sm italic border-l-2 border-neutral-300 bg-neutral-50 text-neutral-700">
              {request.reviewNote}
            </blockquote>
          )}
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      )}
    </div>
  )
}

// ── Section on the transfers page ─────────────────────────────────────────────

export function TransferRequestsSection({
  requests,
  currentUserId,
}: {
  requests: BranchTransferRequests
  currentUserId: string
}) {
  const pendingIncoming = requests.incoming.filter((r) => r.status === "pending")
  const reviewedIncoming = requests.incoming.filter((r) => r.status !== "pending")
  const { outgoing } = requests

  return (
    <div className="space-y-8 mb-10">
      <div>
        <h2 className="text-base font-semibold text-neutral-950 mb-4">
          Incoming requests
          {pendingIncoming.length > 0 && (
            <span className="ml-2 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-violet-700 text-white text-[11px] px-1.5 font-medium leading-none">
              {pendingIncoming.length}
            </span>
          )}
        </h2>
        {pendingIncoming.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-10 text-center">
            <Inbox className="h-8 w-8 text-neutral-300 mb-3" />
            <p className="text-sm font-medium text-neutral-950">No pending requests</p>
            <p className="text-xs text-neutral-400 mt-1">Requests other branches send to this branch appear here.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingIncoming.map((r) => (
              <IncomingRequestCard key={r.id} request={r} />
            ))}
          </div>
        )}
      </div>

      {outgoing.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-neutral-950 mb-4">Requested by this branch</h2>
          <div className="space-y-3">
            {outgoing.map((r) => (
              <RequestSummaryCard
                key={r.id}
                request={r}
                direction="outgoing"
                canCancel={r.status === "pending" && r.requestedBy === currentUserId}
              />
            ))}
          </div>
        </div>
      )}

      {reviewedIncoming.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-neutral-950 mb-4">Reviewed requests</h2>
          <div className="space-y-3">
            {reviewedIncoming.map((r) => (
              <RequestSummaryCard key={r.id} request={r} direction="incoming" canCancel={false} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
