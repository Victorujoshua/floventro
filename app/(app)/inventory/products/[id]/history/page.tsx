import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { requireRole } from "@/lib/auth/guards"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { getProductStockHistory } from "@/lib/db/queries/stock-history"
import { getCurrentScope } from "@/lib/auth/scope"

type Props = {
  params: Promise<{ id: string }>
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default async function ProductHistoryPage({ params }: Props) {
  const scope = await requireRole("owner", "inventory")
  const { id: productId } = await params

  const supabase = await createAppServerClient()

  // Verify the product belongs to this organisation.
  const { data: product } = await supabase
    .from("products")
    .select("id, sku, name")
    .eq("id", productId)
    .eq("organisation_id", scope.organisationId)
    .is("deleted_at", null)
    .single()

  if (!product) notFound()

  // Resolve branch.
  let resolvedBranchId: string | null = scope.branchId ?? null
  if (!resolvedBranchId) {
    const { data: branches } = await supabase
      .from("branches")
      .select("id")
      .eq("organisation_id", scope.organisationId)
      .is("deleted_at", null)

    if (branches && branches.length === 1) {
      resolvedBranchId = branches[0].id
    }
  }

  const rows = await getProductStockHistory(productId, resolvedBranchId)

  return (
    <div>
      {/* Back link */}
      <Link
        href="/inventory/products"
        className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 mb-6"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Products
      </Link>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">
          {product.name}
        </h1>
        <p className="text-sm text-neutral-500 mt-1 font-mono">{product.sku} — Stock history</p>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-neutral-950">No stock movements yet</p>
          <p className="text-sm text-neutral-500 mt-1">
            Movements will appear here once stock is received, adjusted, or fulfilled.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200/60">
                <th className="text-left px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Date
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Movement
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Change
                </th>
                <th className="text-right px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Branch balance
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  By
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Note
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-neutral-50/60 transition-colors">
                  <td className="px-4 py-3.5 text-neutral-500 whitespace-nowrap font-mono text-xs tabular-nums">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="px-4 py-3.5 text-neutral-950">
                    <span>{row.movementLabel}</span>
                    {row.isHolding && (
                      <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-neutral-100 text-neutral-500">
                        holding
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                    <span
                      className={
                        row.quantityDelta > 0
                          ? "text-green-700"
                          : row.quantityDelta < 0
                            ? "text-red-600"
                            : "text-neutral-400"
                      }
                    >
                      {row.quantityDelta > 0 ? "+" : ""}
                      {row.quantityDelta}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                    {row.branchBalance !== null ? (
                      <span className="text-neutral-950">{row.branchBalance}</span>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-neutral-500 text-xs">
                    {row.createdByLabel || "—"}
                  </td>
                  <td className="px-4 py-3.5 text-neutral-500 text-xs max-w-[200px] truncate">
                    {row.note || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
