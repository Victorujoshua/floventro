"use client"

import dynamic from "next/dynamic"

// Recharts is ~100 KB gzipped. Loading it separately lets the page's cards
// render first; the chart fills in once its chunk arrives. Recharts measures
// its container in the browser anyway, so skipping SSR loses nothing.
export const BranchRevenueChart = dynamic(
  () => import("./branch-revenue-chart-inner").then((m) => m.BranchRevenueChart),
  {
    ssr: false,
    loading: () => <div className="h-[200px] rounded-md bg-neutral-100 animate-pulse" />,
  },
)
