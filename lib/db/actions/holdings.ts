"use server"

import { getMyHoldings } from "@/lib/db/queries/holdings"
import type { MyHolding } from "@/lib/db/queries/holdings"

export async function getMyHoldingsAction(): Promise<MyHolding[]> {
  try {
    return await getMyHoldings()
  } catch (err) {
    console.error("[getMyHoldingsAction] failed:", err instanceof Error ? err.stack : JSON.stringify(err))
    throw err
  }
}
