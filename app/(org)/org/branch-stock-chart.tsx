"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { BranchSummary } from "@/lib/db/queries/org"

export function BranchStockChart({ branches }: { branches: BranchSummary[] }) {
  const withStock = branches.filter((b) => b.stockUnits > 0)

  if (withStock.length === 0) {
    return (
      <div className="flex items-center justify-center h-[180px]">
        <p className="text-sm text-neutral-400">No stock recorded across branches yet.</p>
      </div>
    )
  }

  const data = branches.map((b) => ({ name: b.name, units: b.stockUnits }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="#E5E7EB" strokeDasharray="3 3" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "#9CA3AF" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#9CA3AF" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={32}
        />
        <Tooltip
          contentStyle={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: "8px",
            fontSize: "12px",
            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.06)",
          }}
          formatter={(value) => [value, "units on hand"]}
          labelStyle={{ color: "#374151", fontWeight: 500, marginBottom: 2 }}
          cursor={{ fill: "rgba(74, 2, 200, 0.04)" }}
        />
        <Bar dataKey="units" fill="#4A02C8" radius={[3, 3, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  )
}
