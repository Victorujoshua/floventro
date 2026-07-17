"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkles } from "lucide-react"
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
import type { ServiceRecordRow, ServiceRecordDetail } from "@/lib/db/queries/services"
import { getServiceRecordDetailAction } from "@/lib/db/actions/services"
import { formatNaira } from "@/lib/format/money"

type Props = {
  records: ServiceRecordRow[]
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function ServicesPerformedClient({ records }: Props) {
  const router = useRouter()
  const [newServiceOpen, setNewServiceOpen] = useState(false)
  const [detailRecord, setDetailRecord] = useState<ServiceRecordDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

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
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Date
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Service
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Performed by
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Customer
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">
                  Products used
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide text-right">
                  Fee
                </TableHead>
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
                    {record.customerName ?? <span className="text-neutral-300">—</span>}
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums text-neutral-700 py-3.5 text-right">
                    {record.consumptionCount}
                  </TableCell>
                  <TableCell className="text-sm font-mono tabular-nums text-neutral-950 py-3.5 text-right">
                    {record.serviceFeeCents != null ? (
                      <>
                        <span className="font-inter">₦</span>
                        {formatNaira(record.serviceFeeCents)}
                      </>
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

      {/* Detail modal */}
      <Dialog
        open={detailOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDetailOpen(false)
            setDetailRecord(null)
          }
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
                    <span className="text-neutral-950 font-mono tabular-nums">
                      {detailRecord.customerPhone}
                    </span>
                  </div>
                )}
                {detailRecord.serviceFeeCents != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-500">Service fee</span>
                    <span className="text-neutral-950 font-mono tabular-nums font-medium">
                      <span className="font-inter">₦</span>
                      {formatNaira(detailRecord.serviceFeeCents)}
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
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide">
                  Products used
                </p>
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
              </div>
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
