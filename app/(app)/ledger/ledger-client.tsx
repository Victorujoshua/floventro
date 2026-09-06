"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Download } from "lucide-react"
import { fetchOrgLedgerAction } from "@/lib/db/actions/ledger"
import { exportToXlsx } from "@/lib/export/xlsx"
import type { ExportColumn } from "@/lib/export/xlsx"

const LEDGER_COLUMNS: ExportColumn[] = [
  { header: "date",              key: "date" },
  { header: "branch",            key: "branch" },
  { header: "product_name",      key: "product_name" },
  { header: "product_sku",       key: "product_sku" },
  { header: "quantity_delta",    key: "quantity_delta" },
  { header: "reason",            key: "reason" },
  { header: "adjustment_reason", key: "adjustment_reason" },
  { header: "reference_type",    key: "reference_type" },
  { header: "holder",            key: "holder" },
  { header: "created_by",        key: "created_by" },
  { header: "note",              key: "note" },
]

function todayISO(): string {
  return new Date().toISOString().split("T")[0]
}

function firstOfMonthISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
}

export function LedgerClient() {
  const [from, setFrom] = useState(firstOfMonthISO)
  const [to, setTo] = useState(todayISO)
  const [loading, setLoading] = useState(false)

  const handleDownload = async () => {
    if (!from || !to) {
      toast.error("Please select a date range.")
      return
    }
    if (from > to) {
      toast.error("Start date must be before end date.")
      return
    }
    setLoading(true)
    try {
      const rows = await fetchOrgLedgerAction(from, to)
      if (rows.length === 0) {
        toast.info("No ledger entries found for this period.")
        return
      }
      exportToXlsx(
        `stock-ledger_${from}_${to}`,
        rows as unknown as Record<string, unknown>[],
        LEDGER_COLUMNS,
      )
    } catch {
      toast.error("Failed to download ledger. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">
            Stock Ledger
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Org-wide stock movement history — all branches
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200/60 p-6 max-w-lg">
        <p className="text-sm font-medium text-neutral-700 mb-4">Date range</p>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1">
            <label className="block text-xs text-neutral-500 mb-1">From</label>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-md border border-neutral-200 px-3 h-9 text-sm text-neutral-950 focus:outline-none focus:ring-2 focus:ring-violet-600/30 focus:border-violet-600"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-neutral-500 mb-1">To</label>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-md border border-neutral-200 px-3 h-9 text-sm text-neutral-950 focus:outline-none focus:ring-2 focus:ring-violet-600/30 focus:border-violet-600"
            />
          </div>
        </div>

        <button
          onClick={handleDownload}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Download className="h-4 w-4" />
          {loading ? "Preparing…" : "Download XLSX"}
        </button>

        <p className="text-xs text-neutral-400 mt-4">
          Includes all stock movements (receipts, sales, usage, transfers,
          adjustments, issues) for every branch in your organisation.
        </p>
      </div>
    </div>
  )
}
