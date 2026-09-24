"use client"

import dynamic from "next/dynamic"

// Recharts is ~100 KB gzipped. Loading it separately lets the page's cards
// render first; the chart fills in once its chunk arrives. Recharts measures
// its container in the browser anyway, so skipping SSR loses nothing.
export const StockChart = dynamic(
  () => import("./stock-chart-inner").then((m) => m.StockChart),
  {
    ssr: false,
    loading: () => <div className="h-[180px] rounded-md bg-neutral-100 animate-pulse" />,
  },
)
