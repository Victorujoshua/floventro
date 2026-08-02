import { requireScope } from "@/lib/auth/guards"
import { getMyHoldings, getMyHoldingHistory } from "@/lib/db/queries/holdings"
import { HoldingClient } from "./holding-client"

export default async function HoldingPage() {
  await requireScope()
  const [holdings, history] = await Promise.all([
    getMyHoldings(),
    getMyHoldingHistory(),
  ])
  return <HoldingClient holdings={holdings} history={history} />
}
