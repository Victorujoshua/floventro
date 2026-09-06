"use client"

import { useState } from "react"
import { Download, FileSpreadsheet } from "lucide-react"
import { exportToXlsx, downloadTemplate, type ExportColumn } from "@/lib/export/xlsx"

type Props = {
  filename: string
  columns: ExportColumn[]
  rows?: Record<string, unknown>[]
  fetchRows?: () => Promise<Record<string, unknown>[]>
}

export function ExportButton({ filename, columns, rows, fetchRows }: Props) {
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      const data = rows ?? (fetchRows ? await fetchRows() : [])
      exportToXlsx(filename, data, columns)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleExport}
        disabled={exporting}
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50"
      >
        <Download className="h-3 w-3" />
        {exporting ? "Exporting…" : "Export"}
      </button>
      <button
        onClick={() => downloadTemplate(filename, columns)}
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
      >
        <FileSpreadsheet className="h-3 w-3" />
        Template
      </button>
    </div>
  )
}
