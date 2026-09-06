"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { Upload, CheckCircle, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { parseFile } from "@/lib/import/parse"
import { exportToXlsx } from "@/lib/export/xlsx"
import type { ImportResult } from "@/lib/db/actions/import"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type { ImportResult }

type Props = {
  onImport:   (rows: Record<string, unknown>[]) => Promise<ImportResult>
  onSuccess?: () => void
}

export function ImportButton({ onImport, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<ImportResult | null>(null)

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return

    setLoading(true)
    try {
      const rows = await parseFile(file)
      if (rows.length === 0) {
        toast.error("File is empty or has no data rows.")
        return
      }
      const r = await onImport(rows)
      setResult(r)
      if (r.imported > 0) onSuccess?.()
    } catch (err) {
      toast.error("Could not parse file — check it's a valid .xlsx or .csv.")
      console.error("[ImportButton]", err)
    } finally {
      setLoading(false)
    }
  }

  function downloadErrors() {
    if (!result || result.skipped.length === 0) return
    exportToXlsx(
      "import_errors",
      result.skipped as unknown as Record<string, unknown>[],
      [
        { header: "row",    key: "row" },
        { header: "reason", key: "reason" },
      ],
    )
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv"
        className="hidden"
        onChange={handleFile}
      />

      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50"
      >
        <Upload className="h-3 w-3" />
        {loading ? "Importing…" : "Import"}
      </button>

      <Dialog open={!!result} onOpenChange={(o) => { if (!o) setResult(null) }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import result</DialogTitle>
          </DialogHeader>

          {result && (
            <div className="space-y-4 pt-1">
              {/* Summary */}
              <div className="flex items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium text-green-700">
                  <CheckCircle className="h-4 w-4" />
                  {result.imported} imported
                </span>
                {result.skipped.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-orange-600">
                    <AlertTriangle className="h-4 w-4" />
                    {result.skipped.length} skipped
                  </span>
                )}
              </div>

              {/* Warnings (imported but with notes) */}
              {result.warnings.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Notes</p>
                  <ul className="space-y-0.5">
                    {result.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-700">
                        Row {w.row}: {w.note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Skipped rows table */}
              {result.skipped.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                      Skipped rows
                    </p>
                    <button
                      onClick={downloadErrors}
                      className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-700 transition-colors"
                    >
                      Download as xlsx
                    </button>
                  </div>
                  <div className="rounded-md border border-neutral-200 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-neutral-200 bg-neutral-50">
                          <th className="px-3 py-2 text-left font-medium text-neutral-500 w-12">Row</th>
                          <th className="px-3 py-2 text-left font-medium text-neutral-500">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {result.skipped.map((s) => (
                          <tr key={s.row}>
                            <td className="px-3 py-2 text-neutral-400">{s.row}</td>
                            <td className="px-3 py-2 text-neutral-700">{s.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <button
                onClick={() => setResult(null)}
                className="w-full rounded-md bg-neutral-950 text-white h-9 text-sm font-medium hover:bg-neutral-800 transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
