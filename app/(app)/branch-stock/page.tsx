import { requireRole } from "@/lib/auth/guards"
import { getBranchStock } from "@/lib/db/queries/branch-stock"

export default async function BranchStockPage() {
  const scope = await requireRole("owner", "admin", "inventory")

  if (!scope.branchId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Branch stock</h1>
          <p className="text-sm text-neutral-500 mt-1">Products currently held in this branch&apos;s store.</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center">
          <p className="text-sm text-neutral-500">Select a branch to view stock levels.</p>
        </div>
      </div>
    )
  }

  const stock = await getBranchStock()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Branch stock</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Products currently held in this branch&apos;s store. Read-only — this is the pool.
        </p>
      </div>

      {stock.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-10 text-center">
          <p className="text-sm text-neutral-500">No stock recorded for this branch yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-200/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100">
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Product
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  SKU
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Qty in store
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {stock.map((row) => (
                <tr key={row.productId}>
                  <td className="px-6 py-3 font-medium text-neutral-950">{row.name}</td>
                  <td className="px-6 py-3 font-mono text-xs text-neutral-500">{row.sku ?? "—"}</td>
                  <td
                    className={`px-6 py-3 text-right tabular-nums font-mono ${
                      row.quantity === 0 ? "text-red-500" : "text-neutral-700"
                    }`}
                  >
                    {row.quantity.toLocaleString()}
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
