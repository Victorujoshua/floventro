"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, Sparkles, TrendingUp } from "lucide-react"
import { toast } from "sonner"
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
} from "@/components/ui/dialog"
import { RecordServiceDialog } from "@/components/app/dialogs/record-service-dialog"
import type { ServiceRecordRow, ServiceRecordDetail, JobCostingSessionRow } from "@/lib/db/queries/services"
import { getServiceRecordDetailAction } from "@/lib/db/actions/services"
import { formatNaira } from "@/lib/format/money"

type Props = {
  records: ServiceRecordRow[]
  jobCostingSessions: JobCostingSessionRow[]
  role: string
  currentUserId: string
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function nairaCell(cents: number) {
  return (
    <>
      <span className="font-inter">₦</span>
      {formatNaira(cents)}
    </>
  )
}

function Dash() {
  return <span className="text-neutral-300">—</span>
}

// ── Job-costing detail panel (inside the service detail modal) ─────────────

function JobCostingPanel({
  sessionRevenueCents,
  totalCogsCents,
  costFullyKnown,
}: {
  sessionRevenueCents: number | null
  totalCogsCents: number | null
  costFullyKnown: boolean
}) {
  if (sessionRevenueCents == null) return null

  const profitCents =
    totalCogsCents != null ? sessionRevenueCents - totalCogsCents : null
  const profitPct =
    profitCents != null && sessionRevenueCents > 0
      ? (profitCents / sessionRevenueCents) * 100
      : null

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">
        Job costing — plan session
      </p>
      <div className="rounded-lg border border-violet-100 bg-violet-50/40 px-4 py-3 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">Revenue (plan share)</span>
          <span className="font-mono tabular-nums font-medium text-neutral-950">
            {nairaCell(sessionRevenueCents)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">
            Cost of items used
            {!costFullyKnown && (
              <span className="ml-1.5 text-xs text-amber-600">(partial)</span>
            )}
          </span>
          <span className="font-mono tabular-nums text-neutral-950">
            {totalCogsCents != null ? nairaCell(totalCogsCents) : <Dash />}
          </span>
        </div>
        <div className="border-t border-violet-100 pt-2 flex justify-between text-sm">
          <span className="text-neutral-700 font-medium">Profit</span>
          <span
            className={`font-mono tabular-nums font-medium ${
              profitCents == null
                ? "text-neutral-400"
                : profitCents >= 0
                ? "text-emerald-700"
                : "text-red-600"
            }`}
          >
            {profitCents != null ? nairaCell(profitCents) : <Dash />}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">Profit %</span>
          <span
            className={`font-mono tabular-nums ${
              profitPct == null
                ? "text-neutral-400"
                : profitPct >= 0
                ? "text-emerald-700"
                : "text-red-600"
            }`}
          >
            {profitPct != null ? `${profitPct.toFixed(1)}%` : <Dash />}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Job-costing sessions table (internal_use profitability view) ───────────

function JobCostingSessionsSection({
  sessions,
  onRowClick,
}: {
  sessions: JobCostingSessionRow[]
  onRowClick: (id: string) => void
}) {
  if (sessions.length === 0) return null

  return (
    <div className="mt-10">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="h-4 w-4 text-violet-600" />
        <h2 className="text-base font-semibold text-neutral-950">Plan session profitability</h2>
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        Your plan-linked sessions with cost and profit breakdown.
      </p>
      <div className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-neutral-50">
              <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Date</TableHead>
              <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Service</TableHead>
              <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Client</TableHead>
              <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Revenue</TableHead>
              <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Cost</TableHead>
              <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Profit</TableHead>
              <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Margin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => {
              const profitCents =
                s.totalCogsCents != null ? s.sessionRevenueCents - s.totalCogsCents : null
              const profitPct =
                profitCents != null && s.sessionRevenueCents > 0
                  ? (profitCents / s.sessionRevenueCents) * 100
                  : null
              const isPositive = profitCents != null && profitCents >= 0

              return (
                <TableRow
                  key={s.id}
                  className="hover:bg-neutral-50/60 transition-colors cursor-pointer"
                  onClick={() => onRowClick(s.id)}
                >
                  <TableCell className="text-sm text-neutral-700 py-3.5">{formatDate(s.performedOn)}</TableCell>
                  <TableCell className="text-sm font-medium text-neutral-950 py-3.5">{s.serviceTypeName}</TableCell>
                  <TableCell className="text-sm text-neutral-500 py-3.5">{s.customerName ?? <Dash />}</TableCell>
                  <TableCell className="text-sm font-mono tabular-nums text-neutral-950 py-3.5 text-right">
                    {nairaCell(s.sessionRevenueCents)}
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums text-neutral-700 py-3.5 text-right">
                    {s.totalCogsCents != null ? (
                      <>
                        {nairaCell(s.totalCogsCents)}
                        {!s.costFullyKnown && (
                          <span className="block text-xs text-amber-500 font-sans">partial</span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs font-sans text-amber-600">pending →</span>
                    )}
                  </TableCell>
                  <TableCell className={`text-sm font-mono tabular-nums py-3.5 text-right font-medium ${profitCents == null ? "text-neutral-400" : isPositive ? "text-emerald-700" : "text-red-600"}`}>
                    {profitCents != null ? nairaCell(profitCents) : <Dash />}
                  </TableCell>
                  <TableCell className={`text-sm font-mono tabular-nums py-3.5 text-right ${profitPct == null ? "text-neutral-400" : isPositive ? "text-emerald-700" : "text-red-600"}`}>
                    {profitPct != null ? `${profitPct.toFixed(1)}%` : <Dash />}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ── Main client ────────────────────────────────────────────────────────────

export function ServicesPerformedClient({ records, jobCostingSessions, role, currentUserId }: Props) {
  const router = useRouter()
  const [newServiceOpen, setNewServiceOpen] = useState(false)
  const [detailRecord, setDetailRecord]     = useState<ServiceRecordDetail | null>(null)
  const [detailOpen, setDetailOpen]         = useState(false)
  const [loadingDetail, setLoadingDetail]   = useState(false)

  async function openDetail(id: string) {
    setLoadingDetail(true)
    setDetailOpen(true)
    const detail = await getServiceRecordDetailAction(id)
    setLoadingDetail(false)
    if (!detail) {
      toast.error("Could not load service details.")
      setDetailOpen(false)
      return
    }
    setDetailRecord(detail)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">
            Services performed
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Products used delivering client services
          </p>
        </div>
        <button
          onClick={() => setNewServiceOpen(true)}
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
        >
          <Sparkles className="h-4 w-4" />
          Record service
        </button>
      </div>

      {records.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center px-6">
          <Sparkles className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No services recorded yet</p>
          <p className="text-sm text-neutral-500 mt-1">
            Record a service from your holding to see it here.
          </p>
          <button
            onClick={() => setNewServiceOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-9 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            Record service
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50">
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Date</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Service</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Performed by</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Customer</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Products used</TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">Fee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow
                  key={record.id}
                  className="hover:bg-neutral-50/60 transition-colors cursor-pointer"
                  onClick={() => openDetail(record.id)}
                >
                  <TableCell className="text-sm text-neutral-700 py-3.5">
                    {formatDate(record.performedOn)}
                  </TableCell>
                  <TableCell className="text-sm font-medium text-neutral-950 py-3.5">
                    {record.serviceTypeName}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-700 py-3.5">
                    {record.performedByLabel}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-500 py-3.5">
                    <span>{record.customerName ?? <span className="text-neutral-300">—</span>}</span>
                    {record.memberId && (
                      <span className="block text-xs font-mono text-neutral-400">{record.memberId}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums text-neutral-700 py-3.5 text-right">
                    {record.consumptionCount === 0 ? (
                      <span className="text-xs font-sans font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                        pending
                      </span>
                    ) : (
                      record.consumptionCount
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums text-neutral-950 py-3.5 text-right">
                    {record.serviceFeeCents != null ? (
                      <>{nairaCell(record.serviceFeeCents)}</>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Job-costing profitability list — internal_use only */}
      {role === "internal_use" && (
        <JobCostingSessionsSection sessions={jobCostingSessions} onRowClick={openDetail} />
      )}

      {/* Detail modal */}
      <Dialog
        open={detailOpen}
        onOpenChange={(o) => {
          if (!o) { setDetailOpen(false); setDetailRecord(null) }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Service details</DialogTitle>
          </DialogHeader>
          {loadingDetail ? (
            <p className="text-sm text-neutral-500 py-4">Loading…</p>
          ) : detailRecord ? (
            <div className="space-y-5 pt-1">
              {/* Meta */}
              <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Service</span>
                  <span className="text-neutral-950 font-medium">{detailRecord.serviceTypeName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Date</span>
                  <span className="text-neutral-950 font-medium">{formatDate(detailRecord.performedOn)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-500">Performed by</span>
                  <span className="text-neutral-950 font-medium">{detailRecord.performedByLabel}</span>
                </div>
                {detailRecord.customerName && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Customer</span>
                    <span className="text-neutral-950">{detailRecord.customerName}</span>
                  </div>
                )}
                {detailRecord.customerPhone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Phone</span>
                    <span className="text-neutral-950 font-mono tabular-nums">{detailRecord.customerPhone}</span>
                  </div>
                )}
                {detailRecord.memberId && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Member ID</span>
                    <span className="text-neutral-950 font-mono">{detailRecord.memberId}</span>
                  </div>
                )}
                {detailRecord.clientEmail && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Email</span>
                    <span className="text-neutral-950">{detailRecord.clientEmail}</span>
                  </div>
                )}
                {detailRecord.serviceFeeCents != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Service fee</span>
                    <span className="text-neutral-950 font-mono tabular-nums font-medium">
                      {nairaCell(detailRecord.serviceFeeCents)}
                    </span>
                  </div>
                )}
                {detailRecord.note && (
                  <div className="flex justify-between text-sm gap-4">
                    <span className="text-neutral-500 shrink-0">Note</span>
                    <span className="text-neutral-700 text-right">{detailRecord.note}</span>
                  </div>
                )}
              </div>

              {/* Products used */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">
                    Products used
                  </p>
                  {role === "internal_use" && detailRecord.performedByUserId === currentUserId && (
                    <Link
                      href={`/services-performed/${detailRecord.id}/add-items`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-700 hover:text-violet-900 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {detailRecord.lines.length === 0 ? "Add items used" : "Add more items"}
                    </Link>
                  )}
                </div>

                {detailRecord.lines.length > 0 ? (
                  <div className="rounded-lg border border-neutral-100 overflow-hidden divide-y divide-neutral-50">
                    {detailRecord.lines.map((line) => (
                      <div key={line.id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm text-neutral-950">{line.productName}</p>
                          <p className="text-xs font-mono text-neutral-400">{line.productSku}</p>
                        </div>
                        <span className="text-sm font-mono tabular-nums text-neutral-700">
                          {line.quantity} used
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-neutral-400 py-2">No products recorded for this session.</p>
                )}
              </div>

              {/* Job costing (only when session_revenue is set) */}
              <JobCostingPanel
                sessionRevenueCents={detailRecord.sessionRevenueCents}
                totalCogsCents={detailRecord.totalCogsCents}
                costFullyKnown={detailRecord.costFullyKnown}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* New service dialog */}
      <RecordServiceDialog
        open={newServiceOpen}
        onOpenChange={setNewServiceOpen}
        onSuccess={() => router.refresh()}
      />
    </div>
  )
}
