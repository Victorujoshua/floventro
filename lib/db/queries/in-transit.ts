// ── Stock in transit ──────────────────────────────────────────────────────────
//
// Approving a transfer request (approve_transfer_request) removes stock from the
// source branch immediately; it is on
// hand nowhere until receive_transfer credits the destination. For each line of
// a transfer still 'in_transit', the units in transit are
// quantity_sent − coalesce(quantity_received, 0).
//
// Callers select IN_TRANSIT_LINES_SELECT on stock_transfers filtered to
// status = 'in_transit' (plus their own org / branch scope) and pass the rows
// to sumInTransitUnits.

export const IN_TRANSIT_LINES_SELECT = "stock_transfer_lines(quantity_sent, quantity_received)"

type TransferLine = { quantity_sent: number; quantity_received: number | null }
type TransferWithLines = { stock_transfer_lines: TransferLine[] | null }

export function sumInTransitUnits(transfers: TransferWithLines[]): number {
  let units = 0
  for (const t of transfers) {
    for (const line of t.stock_transfer_lines ?? []) {
      units += line.quantity_sent - (line.quantity_received ?? 0)
    }
  }
  return units
}
