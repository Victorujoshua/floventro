import * as XLSX from "xlsx"

export async function parseFile(file: File): Promise<Record<string, unknown>[]> {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("File too large — maximum 5 MB.")
  }

  const ext = file.name.toLowerCase().split(".").pop()

  let wb: XLSX.WorkBook
  if (ext === "csv") {
    const text = await file.text()
    wb = XLSX.read(text, { type: "string" })
  } else {
    const buffer = await file.arrayBuffer()
    wb = XLSX.read(buffer, { type: "array" })
  }

  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" })
}
