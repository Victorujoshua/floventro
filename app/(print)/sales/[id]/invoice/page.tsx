import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { requireScope } from "@/lib/auth/guards"
import { getSaleInvoiceData } from "@/lib/db/queries/invoice-print"
import { formatNaira } from "@/lib/format/money"
import { PrintButton } from "./print-button"

export const metadata: Metadata = { title: "Invoice" }

type Props = { params: Promise<{ id: string }> }

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export default async function InvoicePage({ params }: Props) {
  await requireScope()
  const { id } = await params

  const invoice = await getSaleInvoiceData(id)
  if (!invoice) notFound()

  const isPaid = invoice.paymentStatus === "paid"
  const isPartial = invoice.paymentStatus === "partial"

  return (
    <div className="min-h-screen bg-neutral-100 py-10 px-4">
      <style>{`
        @page {
          size: A4;
          margin: 1.5cm 2cm;
        }
        @media print {
          html, body {
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          .invoice-doc {
            box-shadow: none !important;
            max-width: 100% !important;
            border-radius: 0 !important;
          }
          .paid-seal {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            color-adjust: exact;
          }
          .pay-to-block {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            color-adjust: exact;
          }
        }
      `}</style>

      {/* ── Action bar (screen only) ── */}
      <div className="no-print max-w-[800px] mx-auto mb-6 flex items-center justify-between">
        <p className="text-sm text-neutral-500">
          Invoice preview — click Print to save as PDF
        </p>
        <PrintButton />
      </div>

      {/* ── Invoice document ── */}
      <div className="invoice-doc bg-white max-w-[800px] mx-auto shadow-lg rounded-lg p-12">

        {/* HEADER */}
        <div className="flex items-start justify-between mb-10">
          <div>
            <h1 className="text-2xl font-bold text-neutral-950 tracking-tight">
              {invoice.orgName}
            </h1>
            {invoice.branchName && (
              <p className="text-sm text-neutral-500 mt-0.5">{invoice.branchName}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-neutral-400 tracking-[0.12em]">INVOICE</p>
            <p className="text-sm font-mono text-neutral-600 mt-1">{invoice.invoiceNumber}</p>
            <p className="text-sm text-neutral-500 mt-0.5">{formatDate(invoice.soldOn)}</p>
          </div>
        </div>

        {/* BILL TO */}
        <div className="mb-8">
          <p className="text-[10px] font-medium text-neutral-400 uppercase tracking-[0.15em] mb-2">
            Bill to
          </p>
          {invoice.customerName ? (
            <>
              <p className="text-sm font-semibold text-neutral-950">{invoice.customerName}</p>
              {invoice.customerPhone && (
                <p className="text-sm font-mono text-neutral-500 mt-0.5">{invoice.customerPhone}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-neutral-400 italic">Walk-in customer</p>
          )}
        </div>

        <hr className="border-neutral-200 mb-6" />

        {/* LINE ITEMS TABLE */}
        <table className="w-full text-sm mb-2">
          <thead>
            <tr className="border-b border-neutral-200">
              <th className="text-left pb-3 text-[10px] font-medium text-neutral-400 uppercase tracking-[0.12em]">
                Product
              </th>
              <th className="text-right pb-3 text-[10px] font-medium text-neutral-400 uppercase tracking-[0.12em] w-14">
                Qty
              </th>
              <th className="text-right pb-3 text-[10px] font-medium text-neutral-400 uppercase tracking-[0.12em] w-36">
                Unit price
              </th>
              <th className="text-right pb-3 text-[10px] font-medium text-neutral-400 uppercase tracking-[0.12em] w-36">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td className="py-3.5">
                  <p className="font-medium text-neutral-950">{line.productName}</p>
                  {line.productSku && (
                    <p className="text-xs font-mono text-neutral-400 mt-0.5">{line.productSku}</p>
                  )}
                </td>
                <td className="py-3.5 text-right tabular-nums text-neutral-700">
                  {line.quantity}
                </td>
                <td className="py-3.5 text-right tabular-nums text-neutral-700">
                  <span className="font-inter">₦</span>
                  {formatNaira(line.unitPriceCents)}
                </td>
                <td className="py-3.5 text-right tabular-nums font-semibold text-neutral-950">
                  <span className="font-inter">₦</span>
                  {formatNaira(line.lineTotalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* TOTALS */}
        <div className="flex justify-end mt-4 mb-8">
          <div className="w-64">
            <div className="flex justify-between text-sm text-neutral-500 mb-1.5">
              <span>Subtotal</span>
              <span className="tabular-nums">
                <span className="font-inter">₦</span>
                {formatNaira(invoice.totalCents)}
              </span>
            </div>
            <div className="flex justify-between text-base font-bold text-neutral-950 border-t border-neutral-300 pt-2.5 mt-2.5">
              <span>Total</span>
              <span className="tabular-nums">
                <span className="font-inter">₦</span>
                {formatNaira(invoice.totalCents)}
              </span>
            </div>
          </div>
        </div>

        {/* PAYMENT STATUS BLOCK */}
        {isPaid ? (
          <div className="relative border border-emerald-100 rounded-lg px-6 py-5 bg-emerald-50/40 overflow-hidden">
            <div className="pr-32">
              <p className="text-sm font-semibold text-neutral-800">Payment received</p>
              <p className="text-sm text-neutral-500 mt-0.5">
                Paid in full — thank you for your business.
              </p>
            </div>
            {/* PAID stamp */}
            <div className="paid-seal absolute right-7 top-1/2 -translate-y-1/2 rotate-[-15deg] border-[3px] border-emerald-600 rounded px-4 py-2 opacity-85">
              <p className="text-xl font-black tracking-[0.25em] text-emerald-600 leading-none text-center">
                PAID
              </p>
              <p className="text-[9px] font-mono text-emerald-700/80 mt-1.5 tracking-wider text-center">
                {formatDate(invoice.soldOn)}
              </p>
            </div>
          </div>
        ) : (
          <div className="pay-to-block border border-amber-200 rounded-lg px-6 py-5 bg-amber-50">
            {isPartial && (
              <div className="flex justify-between text-sm mb-4 pb-4 border-b border-amber-200">
                <div className="space-y-0.5">
                  <span className="block text-[10px] font-medium text-amber-700/70 uppercase tracking-[0.12em]">
                    Amount paid
                  </span>
                  <span className="tabular-nums font-semibold text-neutral-950">
                    <span className="font-inter">₦</span>
                    {formatNaira(invoice.amountPaidCents)}
                  </span>
                </div>
                <div className="text-right space-y-0.5">
                  <span className="block text-[10px] font-medium text-amber-700/70 uppercase tracking-[0.12em]">
                    Balance due
                  </span>
                  <span className="tabular-nums font-bold text-amber-700">
                    <span className="font-inter">₦</span>
                    {formatNaira(invoice.outstandingCents)}
                  </span>
                </div>
              </div>
            )}
            {invoice.payoutAccount ? (
              <>
                <p className="text-[10px] font-medium text-neutral-500 uppercase tracking-[0.15em] mb-3">
                  Please pay to
                </p>
                <div className="space-y-2">
                  {invoice.payoutAccount.accountName && (
                    <div className="flex gap-4 text-sm">
                      <span className="text-neutral-400 w-32 shrink-0">Account name</span>
                      <span className="font-semibold text-neutral-950">
                        {invoice.payoutAccount.accountName}
                      </span>
                    </div>
                  )}
                  {invoice.payoutAccount.accountNumber && (
                    <div className="flex gap-4 text-sm">
                      <span className="text-neutral-400 w-32 shrink-0">Account number</span>
                      <span className="font-mono font-semibold text-neutral-950 tracking-wider">
                        {invoice.payoutAccount.accountNumber}
                      </span>
                    </div>
                  )}
                  {invoice.payoutAccount.bankName && (
                    <div className="flex gap-4 text-sm">
                      <span className="text-neutral-400 w-32 shrink-0">Bank</span>
                      <span className="font-semibold text-neutral-950">
                        {invoice.payoutAccount.bankName}
                      </span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-neutral-500 italic">
                Payment details not configured — set up a payout account in Settings.
              </p>
            )}
          </div>
        )}

        {/* FOOTER */}
        <div className="mt-10 pt-6 border-t border-neutral-100 text-center">
          <p className="text-sm text-neutral-400">Thank you for your business.</p>
          <p className="text-xs text-neutral-300 mt-1">Generated by Floventro</p>
        </div>
      </div>
    </div>
  )
}
