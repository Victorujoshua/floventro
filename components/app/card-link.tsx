import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"

// Whole-card link pattern for dashboard metric cards.
// Pass the card's own surface classes (bg, rounded-2xl, border, padding) via className;
// this adds the shared hover / focus / press behaviour on top.
export const CARD_LINK_INTERACTION =
  "group block cursor-pointer transition-[border-color,box-shadow,transform] duration-150 ease-out " +
  "hover:border-neutral-300 hover:shadow-sm active:scale-[0.99] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600/30"

export function CardLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Link href={href} className={cn(CARD_LINK_INTERACTION, className)}>
      {children}
    </Link>
  )
}

// Corner arrow cue for cards that already showed one. Purely visual now —
// the whole card is the link, so this must not be a nested <a>.
export function CardArrow() {
  return (
    <span aria-hidden className="rounded-full bg-white/60 p-1.5 transition-colors group-hover:bg-white">
      <ArrowUpRight className="h-4 w-4 text-neutral-600" />
    </span>
  )
}
