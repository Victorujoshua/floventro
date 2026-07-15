import { requireScope } from "@/lib/auth/guards"
import { getMyHoldings } from "@/lib/db/queries/holdings"
import { HoldingClient } from "./holding-client"

export default async function HoldingPage() {
  await requireScope()
  const holdings = await getMyHoldings()
  return <HoldingClient holdings={holdings} />
}
