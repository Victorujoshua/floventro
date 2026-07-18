"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { formatNaira } from "@/lib/format/money"
import type { OrgBranchRevenue } from "@/lib/db/queries/org"

export function BranchRevenueChart({ branches }: { branches: OrgBranchRevenue[] }) {
  const withRevenue = branches.filter((b) => b.revenueCents > 0)

  if (withRevenue.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px]">
        <p className="text-sm text-neutral-400">No sales recorded in the last 30 days.</p>
      </div>
    )
  }

  const data = branches.map((b) => ({
    name: b.branchName,
    Revenue: b.revenueCents,
    Profit: b.profitCents,
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 8 }}>
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
          width={72}
          tickFormatter={(v: number) => `₦${formatNaira(v)}`}
        />
        <Tooltip
          contentStyle={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: "8px",
            fontSize: "12px",
            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.06)",
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any, name: any) => [`₦${formatNaira(value ?? 0)}`, String(name ?? "")]}
          labelStyle={{ color: "#374151", fontWeight: 500, marginBottom: 2 }}
          cursor={{ fill: "rgba(74, 2, 200, 0.04)" }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "#6B7280", paddingTop: 8 }}
          iconType="rect"
          iconSize={10}
        />
        <Bar dataKey="Revenue" fill="#4A02C8" radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Bar dataKey="Profit" fill="#10B981" radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}
