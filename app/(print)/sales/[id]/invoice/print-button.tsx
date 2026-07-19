"use client"

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-5 h-10 text-sm font-medium text-white hover:bg-neutral-800 transition-colors active:scale-[0.98] cursor-pointer"
    >
      Print / Save as PDF
    </button>
  )
}
