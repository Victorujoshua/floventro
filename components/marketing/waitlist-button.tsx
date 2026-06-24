"use client"

import { cn } from "@/lib/utils"
import { useWaitlistModal } from "@/components/marketing/waitlist-modal"

type Variant = "primary" | "outline" | "primary-on-dark"

interface WaitlistButtonProps {
  variant?: Variant
  className?: string
  children?: React.ReactNode
}

export default function WaitlistButton({
  variant = "primary",
  className,
  children,
}: WaitlistButtonProps) {
  const { setOpen } = useWaitlistModal()

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn(
        "inline-flex items-center justify-center rounded-none px-5 h-11 text-sm font-medium",
        "active:scale-[0.98] transition-all duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        variant === "primary" && "bg-brand-violet text-white hover:bg-brand-violet/90",
        variant === "outline" && "border border-ink/20 text-ink hover:bg-ink/5",
        variant === "primary-on-dark" && "bg-brand-coral text-white hover:bg-brand-coral/90",
        className,
      )}
    >
      {children ?? "Join Waitlist →"}
    </button>
  )
}
