"use client"

import { useRouter } from "next/navigation"
import { ImportButton } from "@/components/app/import-button"
import { importInvoicesAction } from "@/lib/db/actions/import"

export function InvoiceImportButton() {
  const router = useRouter()
  return (
    <ImportButton
      onImport={importInvoicesAction}
      onSuccess={() => router.refresh()}
    />
  )
}
