"use client"

import { TrendingUp } from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

type Point = { date: string; units: number }

function formatLabel(dateStr: string): string {
  const parts = dateStr.split("-")
  const month = parseInt(parts[1])
  const day = parseInt(parts[2])
  const months = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[month]} ${day}`
}

export function StockChart({ series }: { series: Point[] }) {
  const daysWithData = series.filter((d) => d.units > 0).length

  if (daysWithData < 3) {
    return (
      <div className="flex flex-col items-center justify-center h-[180px] gap-3 text-center">
        <TrendingUp className="h-8 w-8 text-violet-200" />
        <p className="text-sm text-neutral-500 max-w-xs">
          Not enough data yet — record more invoices to see stock trends.
        </p>
      </div>
    )
  }

  const chartData = series.map((d) => ({ ...d, label: formatLabel(d.date) }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="#E5E7EB" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "#9CA3AF" }}
          axisLine={false}
          tickLine={false}
          interval={4}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#9CA3AF" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={28}
        />
        <Tooltip
          contentStyle={{
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: "8px",
            fontSize: "12px",
            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.06)",
          }}
          formatter={(value) => [value, "units received"]}
          labelStyle={{ color: "#374151", fontWeight: 500, marginBottom: 2 }}
          cursor={{ fill: "rgba(74, 2, 200, 0.04)" }}
        />
        <Bar dataKey="units" fill="#4A02C8" radius={[3, 3, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  )
}
