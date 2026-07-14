"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Plus, X, ClipboardList } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { requestSchema, type RequestInput } from "@/lib/validation/requests"
import { createRequestAction, cancelRequestAction } from "@/lib/db/actions/requests"
import type { MyRequest } from "@/lib/db/queries/requests"

type Product = { id: string; sku: string; name: string }
type Branch = { id: string; name: string }

type Props = {
  myRequests: MyRequest[]
  products: Product[]
  resolvedBranchId: string | null
  branches: Branch[]
}

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 disabled:cursor-not-allowed disabled:opacity-50"

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending:             { label: "Pending",            className: "bg-tint-amber text-amber-700" },
  approved:            { label: "Approved",           className: "bg-tint-success text-green-700" },
  partially_approved:  { label: "Partial",            className: "bg-tint-amber text-amber-700" },
  rejected:            { label: "Rejected",           className: "bg-tint-coral text-red-700" },
  cancelled:           { label: "Cancelled",          className: "bg-neutral-100 text-neutral-600" },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, className: "bg-neutral-100 text-neutral-600" }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

const REVIEWED_STATUSES = new Set(["approved", "partially_approved", "rejected"])

function ReviewBlock({
  status,
  reviewedAt,
  reviewNote,
  reviewerLabel,
}: {
  status: string
  reviewedAt: string | null
  reviewNote: string | null
  reviewerLabel: string
}) {
  const isPartialOrRejected = status === "partially_approved" || status === "rejected"
  const noteClass = isPartialOrRejected
    ? "border-l-2 border-amber-400 bg-amber-50 text-amber-800"
    : "border-l-2 border-neutral-300 bg-neutral-50 text-neutral-700"

  return (
    <div className="px-5 py-3 border-t border-neutral-100 space-y-2">
      <p className="text-xs text-neutral-500">
        {reviewerLabel ? (
          <>
            Reviewed by{" "}
            <span className="font-medium text-neutral-700">{reviewerLabel}</span>
            {reviewedAt ? <> · {formatDate(reviewedAt)}</> : null}
          </>
        ) : reviewedAt ? (
          <>Reviewed {formatDate(reviewedAt)}</>
        ) : null}
      </p>
      {reviewNote && (
        <blockquote className={`rounded-lg px-3 py-2 text-sm italic ${noteClass}`}>
          {reviewNote}
        </blockquote>
      )}
    </div>
  )
}

export function RequestsClient({ myRequests, products, resolvedBranchId, branches }: Props) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RequestInput>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      branchId: resolvedBranchId ?? undefined,
      purpose: "",
      lines: [{ productId: "", quantity: 1 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: "lines" })

  function openModal() {
    reset({
      branchId: resolvedBranchId ?? undefined,
      purpose: "",
      lines: [{ productId: "", quantity: 1 }],
    })
    setIsOpen(true)
  }

  async function onSubmit(values: RequestInput) {
    const result = await createRequestAction(values)
    if (!result.ok) {
      toast.error(result.message ?? result.error)
      return
    }
    toast.success("Request submitted")
    setIsOpen(false)
    router.refresh()
  }

  async function handleCancel(id: string) {
    if (confirmCancel !== id) {
      setConfirmCancel(id)
      return
    }
    setCancelling(id)
    const result = await cancelRequestAction(id)
    setCancelling(null)
    setConfirmCancel(null)
    if (result.ok) {
      toast.success("Request cancelled")
      router.refresh()
    } else {
      toast.error("Failed to cancel request")
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Requests</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Request stock from the inventory team
          </p>
        </div>
        <button
          onClick={openModal}
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New request
        </button>
      </div>

      {/* My requests */}
      {myRequests.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center">
          <ClipboardList className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No requests yet</p>
          <p className="text-sm text-neutral-500 mt-1">Request stock when you need it.</p>
          <button
            onClick={openModal}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New request
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {myRequests.map((req) => (
            <div
              key={req.id}
              className="bg-white rounded-2xl border border-neutral-200/60 overflow-hidden"
            >
              {/* Request header row */}
              <div className="px-5 py-4 flex items-center justify-between gap-4 border-b border-neutral-100">
                <div className="flex items-center gap-3 min-w-0">
                  <StatusBadge status={req.status} />
                  {req.purpose ? (
                    <p className="text-sm text-neutral-700 truncate">&ldquo;{req.purpose}&rdquo;</p>
                  ) : (
                    <p className="text-sm text-neutral-400">No purpose noted</p>
                  )}
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-xs text-neutral-400">{formatDate(req.createdAt)}</span>
                  {req.status === "pending" && (
                    <>
                      {confirmCancel === req.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-neutral-500">Cancel?</span>
                          <button
                            onClick={() => handleCancel(req.id)}
                            disabled={cancelling === req.id}
                            className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            {cancelling === req.id ? "…" : "Yes"}
                          </button>
                          <button
                            onClick={() => setConfirmCancel(null)}
                            className="text-xs text-neutral-400 hover:text-neutral-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => handleCancel(req.id)}
                          className="text-xs font-medium text-neutral-400 hover:text-red-600 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Lines */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-neutral-50">
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                      Product
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide tabular-nums">
                      Requested
                    </th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide tabular-nums">
                      Approved
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {req.lines.map((line) => {
                    const isShort =
                      line.quantityApproved !== null &&
                      line.quantityApproved < line.quantityRequested
                    return (
                      <tr key={line.id} className="hover:bg-neutral-50/60 transition-colors">
                        <td className="px-5 py-3.5">
                          <span className="font-medium text-neutral-950">{line.productName}</span>
                          {line.productSku && (
                            <span className="ml-1.5 text-xs text-neutral-400 font-mono">
                              {line.productSku}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right tabular-nums text-neutral-700">
                          {line.quantityRequested}
                        </td>
                        <td className="px-5 py-3.5 text-right tabular-nums">
                          {line.quantityApproved === null ? (
                            <span className="text-neutral-400">—</span>
                          ) : isShort ? (
                            <span className={line.quantityApproved === 0 ? "text-red-600" : "text-amber-600"}>
                              {line.quantityApproved} of {line.quantityRequested} approved
                            </span>
                          ) : (
                            <span className="text-green-700">{line.quantityApproved}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Review block — visible on all terminal statuses */}
              {REVIEWED_STATUSES.has(req.status) && (
                <ReviewBlock
                  status={req.status}
                  reviewedAt={req.reviewedAt}
                  reviewNote={req.reviewNote}
                  reviewerLabel={req.reviewerLabel}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* New request dialog */}
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) setIsOpen(false) }}>
        <DialogContent className="rounded-2xl max-w-xl">
          <DialogHeader>
            <DialogTitle>New stock request</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-1">
            {/* Branch selector for multi-branch owner */}
            {branches.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="branchId">Branch</Label>
                <select id="branchId" {...register("branchId")} className={SELECT_CLASS}>
                  <option value="">Select a branch…</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {errors.branchId && (
                  <p className="text-xs text-red-500">{errors.branchId.message}</p>
                )}
              </div>
            )}

            {/* Purpose */}
            <div className="space-y-1.5">
              <Label htmlFor="purpose">Purpose <span className="text-neutral-400 font-normal">(optional)</span></Label>
              <textarea
                id="purpose"
                rows={2}
                placeholder="Why do you need this stock? e.g. Client session on Thursday"
                {...register("purpose")}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
              />
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-neutral-950">Products</h2>
                <button
                  type="button"
                  onClick={() => append({ productId: "", quantity: 1 })}
                  className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add product
                </button>
              </div>

              {typeof errors.lines?.message === "string" && (
                <p className="mb-2 text-xs text-red-500">{errors.lines.message}</p>
              )}

              <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_96px_36px] gap-3 px-4 py-2 bg-neutral-50 border-b border-neutral-200">
                  <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Product</span>
                  <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Qty</span>
                  <span />
                </div>

                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="grid grid-cols-[1fr_96px_36px] gap-3 items-start px-4 py-3 border-b border-neutral-100 last:border-0"
                  >
                    <div>
                      <select
                        {...register(`lines.${index}.productId`)}
                        className={SELECT_CLASS}
                      >
                        <option value="">Select product…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} — {p.name}
                          </option>
                        ))}
                      </select>
                      {errors.lines?.[index]?.productId && (
                        <p className="mt-1 text-xs text-red-500">
                          {errors.lines[index].productId?.message}
                        </p>
                      )}
                    </div>

                    <div>
                      <Input
                        type="number"
                        min={1}
                        {...register(`lines.${index}.quantity`, { valueAsNumber: true })}
                        className="rounded-md"
                      />
                      {errors.lines?.[index]?.quantity && (
                        <p className="mt-1 text-xs text-red-500">
                          {errors.lines[index].quantity?.message}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => remove(index)}
                      disabled={fields.length === 1}
                      className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:pointer-events-none disabled:opacity-30 transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsOpen(false)}
                className="rounded-md text-sm h-9"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-violet-700 hover:bg-violet-800 text-white text-sm h-9"
              >
                {isSubmitting ? "Submitting…" : "Submit request"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
