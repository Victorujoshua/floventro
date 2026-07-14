"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABELS,
  ADJUSTMENT_REASON_HINTS,
  type AdjustmentReason,
} from "@/lib/validation/adjustments"
import { adjustStockAction } from "@/lib/db/actions/adjustments"

type ProductInfo = {
  id: string
  sku: string
  name: string
  stock: number
  hasHistory: boolean
}

type Branch = { id: string; name: string }

type Props = {
  product: ProductInfo | null
  resolvedBranchId: string | null
  branches: Branch[]
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 disabled:cursor-not-allowed disabled:opacity-50"

export function AdjustDialog({ product, resolvedBranchId, branches, open, onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<"set" | "adjust">("set")
  const [newQuantity, setNewQuantity] = useState<string>("")
  const [delta, setDelta] = useState<string>("")
  const [adjustmentReason, setAdjustmentReason] = useState<string>("")
  const [note, setNote] = useState("")
  const [branchId, setBranchId] = useState<string>(resolvedBranchId ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!product) return null

  const currentStock = product.stock
  const openingStockDisabled = product.hasHistory || currentStock > 0

  // Derive live preview
  const parsedQty = newQuantity !== "" ? parseInt(newQuantity) : NaN
  const parsedDelta = delta !== "" ? parseInt(delta) : NaN

  let previewNew: number | null = null
  let previewDelta: number | null = null

  if (mode === "set" && !isNaN(parsedQty)) {
    previewNew = parsedQty
    previewDelta = parsedQty - currentStock
  } else if (mode === "adjust" && !isNaN(parsedDelta)) {
    previewDelta = parsedDelta
    previewNew = currentStock + parsedDelta
  }

  const noteRequired =
    previewDelta !== null && (previewDelta < 0 || previewDelta >= 100)

  const selectedHint =
    adjustmentReason && ADJUSTMENT_REASON_HINTS[adjustmentReason as AdjustmentReason]

  function handleClose() {
    setMode("set")
    setNewQuantity("")
    setDelta("")
    setAdjustmentReason("")
    setNote("")
    setError(null)
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!product) return
    setError(null)

    if (!branchId && branches.length > 1) {
      setError("Select a branch.")
      return
    }
    if (!adjustmentReason) {
      setError("Select an adjustment reason.")
      return
    }

    const qty = mode === "set" ? parsedQty : undefined
    const dlt = mode === "adjust" ? parsedDelta : undefined

    if (mode === "set" && isNaN(parsedQty)) {
      setError("Enter the new quantity.")
      return
    }
    if (mode === "adjust" && isNaN(parsedDelta)) {
      setError("Enter the adjustment amount.")
      return
    }

    setSubmitting(true)
    const result = await adjustStockAction({
      productId: product.id,
      branchId: branchId || undefined,
      mode,
      newQuantity: qty,
      delta: dlt,
      adjustmentReason: adjustmentReason as AdjustmentReason,
      note,
    })
    setSubmitting(false)

    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }

    toast.success(`Stock updated → ${result.data.newQuantity} units`)
    handleClose()
    onSuccess()
  }

  const deltaSign = previewDelta !== null && previewDelta >= 0 ? "+" : ""

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-1">
          {/* Product info */}
          <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-4 py-3">
            <p className="text-sm font-semibold text-neutral-950">{product.name}</p>
            <p className="text-xs text-neutral-500 font-mono mt-0.5">{product.sku}</p>
            <p className="mt-2 text-sm text-neutral-600">
              Current stock:{" "}
              <span className="font-semibold text-neutral-950 tabular-nums">
                {currentStock}
              </span>
            </p>
          </div>

          {/* Branch selector for multi-branch owner */}
          {!resolvedBranchId && branches.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="branchId">Branch</Label>
              <select
                id="branchId"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">Select a branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Mode toggle */}
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <div className="flex gap-2">
              {(["set", "adjust"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m)
                    setNewQuantity("")
                    setDelta("")
                  }}
                  className={`rounded-full px-4 h-8 text-sm font-medium transition-colors ${
                    mode === m
                      ? "bg-neutral-950 text-white"
                      : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {m === "set" ? "Set to" : "Adjust by"}
                </button>
              ))}
            </div>
          </div>

          {/* Quantity input */}
          <div className="space-y-1.5">
            <Label htmlFor="qty">
              {mode === "set" ? "New quantity" : "Change amount"}
            </Label>
            {mode === "set" ? (
              <input
                id="qty"
                type="number"
                min={0}
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                placeholder="e.g. 50"
                className="flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm tabular-nums text-neutral-950 placeholder:text-neutral-400 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700"
              />
            ) : (
              <input
                id="qty"
                type="number"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="e.g. −12 for damage, +5 for a find"
                className="flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm tabular-nums text-neutral-950 placeholder:text-neutral-400 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700"
              />
            )}

            {/* Live preview */}
            {previewNew !== null && previewDelta !== null && (
              <p className={`text-xs mt-1 ${previewNew < 0 ? "text-red-600" : "text-neutral-500"}`}>
                Stock will change from{" "}
                <span className="tabular-nums font-medium text-neutral-950">{currentStock}</span>
                {" → "}
                <span className="tabular-nums font-medium text-neutral-950">{previewNew}</span>
                {" ("}
                <span
                  className={`tabular-nums font-medium ${
                    previewDelta < 0 ? "text-red-600" : "text-green-700"
                  }`}
                >
                  {deltaSign}{previewDelta}
                </span>
                {")"}
              </p>
            )}
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="reason">
              Reason <span className="text-red-500">*</span>
            </Label>
            <select
              id="reason"
              value={adjustmentReason}
              onChange={(e) => setAdjustmentReason(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Select a reason…</option>
              {ADJUSTMENT_REASONS.map((r) => (
                <option
                  key={r}
                  value={r}
                  disabled={r === "opening_stock" && openingStockDisabled}
                >
                  {ADJUSTMENT_REASON_LABELS[r]}
                  {r === "opening_stock" && openingStockDisabled ? " (not available)" : ""}
                </option>
              ))}
            </select>
            {selectedHint && (
              <p className="text-xs text-neutral-500">{selectedHint}</p>
            )}
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="note">
              Note
              {noteRequired && <span className="text-red-500 ml-1">*</span>}
              {!noteRequired && (
                <span className="text-neutral-400 font-normal ml-1">(optional)</span>
              )}
            </Label>
            <textarea
              id="note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                noteRequired
                  ? "Required — explain this adjustment"
                  : "e.g. physical count on 14 Jul"
              }
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-neutral-200 px-4 h-9 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-violet-700 px-4 h-9 text-sm font-medium text-white hover:bg-violet-800 transition-colors disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save adjustment"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
