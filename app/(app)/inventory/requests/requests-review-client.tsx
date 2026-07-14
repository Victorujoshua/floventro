"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ClipboardCheck } from "lucide-react"
import { reviewRequestAction } from "@/lib/db/actions/requests"
import type { PendingRequest, ReviewedRequest } from "@/lib/db/queries/requests"

type Props = {
  pendingRequests: PendingRequest[]
  reviewedRequests: ReviewedRequest[]
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  approved:           { label: "Approved",  className: "bg-tint-success text-green-700" },
  partially_approved: { label: "Partial",   className: "bg-tint-amber text-amber-700" },
  rejected:           { label: "Rejected",  className: "bg-tint-coral text-red-700" },
  cancelled:          { label: "Cancelled", className: "bg-neutral-100 text-neutral-600" },
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

function RequestReviewCard({ request }: { request: PendingRequest }) {
  const router = useRouter()

  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const line of request.lines) {
      init[line.id] = Math.min(line.quantityRequested, line.inStock)
    }
    return init
  })
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDecision(decision: "approve" | "reject") {
    setSubmitting(true)
    setError(null)

    const lines = request.lines.map((l) => ({
      lineId: l.id,
      quantityApproved: decision === "reject" ? 0 : (qtys[l.id] ?? 0),
    }))

    const result = await reviewRequestAction(request.id, decision, lines, note)
    setSubmitting(false)

    if (!result.ok) {
      setError(result.message ?? result.error)
      return
    }

    toast.success(decision === "approve" ? "Request approved" : "Request rejected")
    router.refresh()
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200/60 overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-neutral-950">
            {request.requesterName || request.requesterEmail}
          </p>
          {request.requesterName && (
            <p className="text-xs text-neutral-500">{request.requesterEmail}</p>
          )}
          {request.purpose && (
            <p className="mt-1 text-xs text-neutral-600 italic">
              &ldquo;{request.purpose}&rdquo;
            </p>
          )}
        </div>
        <p className="text-xs text-neutral-400 shrink-0">{formatDate(request.createdAt)}</p>
      </div>

      {/* Lines table */}
      <div className="overflow-x-auto">
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
                In stock
              </th>
              <th className="px-5 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide w-36">
                Approve qty
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {request.lines.map((line) => {
              const isLow = line.inStock < line.quantityRequested
              return (
                <tr
                  key={line.id}
                  className={isLow ? "bg-amber-50/40" : "hover:bg-neutral-50/60 transition-colors"}
                >
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
                  <td
                    className={`px-5 py-3.5 text-right tabular-nums font-medium ${
                      isLow ? "text-amber-600" : "text-neutral-700"
                    }`}
                  >
                    {line.inStock}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <input
                      type="number"
                      min={0}
                      max={line.quantityRequested}
                      value={qtys[line.id] ?? 0}
                      onChange={(e) => {
                        const val = Math.min(
                          line.quantityRequested,
                          Math.max(0, parseInt(e.target.value) || 0),
                        )
                        setQtys((prev) => ({ ...prev, [line.id]: val }))
                      }}
                      className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-right tabular-nums text-neutral-950 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Footer: note + actions */}
      <div className="px-5 py-4 border-t border-neutral-100 space-y-3">
        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {error}
          </p>
        )}
        <textarea
          placeholder="Note to requester (optional)"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
        />
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
            {submitting ? "Saving…" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  )
}

export function RequestsReviewClient({ pendingRequests, reviewedRequests }: Props) {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Stock requests</h1>
        <p className="text-sm text-neutral-500 mt-1">Review requests from your team</p>
      </div>

      {/* Pending section */}
      <div>
        <h2 className="text-base font-semibold text-neutral-950 mb-4">
          Pending
          {pendingRequests.length > 0 && (
            <span className="ml-2 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-violet-700 text-white text-[11px] px-1.5 font-medium leading-none">
              {pendingRequests.length}
            </span>
          )}
        </h2>

        {pendingRequests.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-14 text-center">
            <ClipboardCheck className="h-9 w-9 text-neutral-300 mb-3" />
            <p className="text-sm font-medium text-neutral-950">All caught up</p>
            <p className="text-xs text-neutral-400 mt-1">No pending stock requests.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingRequests.map((req) => (
              <RequestReviewCard key={req.id} request={req} />
            ))}
          </div>
        )}
      </div>

      {/* History section */}
      {reviewedRequests.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-neutral-950 mb-4">History</h2>
          <div className="bg-white rounded-2xl border border-neutral-200/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-100">
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Date
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Requester
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Purpose
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Lines
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {reviewedRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="px-5 py-3.5 text-neutral-500 text-xs">
                      {formatDate(req.createdAt)}
                    </td>
                    <td className="px-5 py-3.5 text-neutral-950 font-medium">
                      {req.requesterLabel || <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-neutral-600 max-w-[200px] truncate">
                      {req.purpose || <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-neutral-500 tabular-nums">
                      {req.lines.length} product{req.lines.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={req.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
