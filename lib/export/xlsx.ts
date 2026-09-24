// SheetJS is ~140 KB gzipped, so it's loaded on demand when a user actually
// exports, rather than shipping with every list page that has an Export button.
const loadXlsx = () => import("xlsx")

export type ExportColumn = { header: string; key: string }

export async function exportToXlsx(
  filename: string,
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
): Promise<void> {
  const XLSX = await loadXlsx()
  const sheetRows = rows.map((row) =>
    Object.fromEntries(columns.map((col) => [col.header, row[col.key] ?? ""])),
  )
  const ws = XLSX.utils.json_to_sheet(sheetRows, { header: columns.map((c) => c.header) })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

export async function downloadTemplate(filename: string, columns: ExportColumn[]): Promise<void> {
  const XLSX = await loadXlsx()
  const ws = XLSX.utils.aoa_to_sheet([columns.map((c) => c.header)])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
  XLSX.writeFile(wb, `${filename}_template.xlsx`)
}
