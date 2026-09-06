import * as XLSX from "xlsx"

export type ExportColumn = { header: string; key: string }

export function exportToXlsx(
  filename: string,
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
): void {
  const sheetRows = rows.map((row) =>
    Object.fromEntries(columns.map((col) => [col.header, row[col.key] ?? ""])),
  )
  const ws = XLSX.utils.json_to_sheet(sheetRows, { header: columns.map((c) => c.header) })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export function downloadTemplate(filename: string, columns: ExportColumn[]): void {
  const ws = XLSX.utils.aoa_to_sheet([columns.map((c) => c.header)])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  XLSX.writeFile(wb, `${filename}_template.xlsx`)
}
