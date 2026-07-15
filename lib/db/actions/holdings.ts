"use server"

import { getMyHoldings, type MyHolding } from "@/lib/db/queries/holdings"

export type { MyHolding }

export async function getMyHoldingsAction(): Promise<MyHolding[]> {
  try {
    return await getMyHoldings()
  } catch (err) {
    console.error("[getMyHoldingsAction] failed:", err)
    throw err
  }
}
