"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Loader2, CheckCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { waitlistSchema, type WaitlistInput } from "@/lib/validation/waitlist"

interface WaitlistFormProps {
  variant?: "light" | "dark"
}

export default function WaitlistForm({ variant = "light" }: WaitlistFormProps) {
  const searchParams = useSearchParams()
  const [submitted, setSubmitted] = useState(false)
  const [alreadyOnList, setAlreadyOnList] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { isSubmitting, errors },
  } = useForm<WaitlistInput>({
    resolver: zodResolver(waitlistSchema),
  })

  // Capture UTM params into hidden fields on mount
  useEffect(() => {
    const utmFields = ["utm_source", "utm_medium", "utm_campaign", "referrer"] as const
    utmFields.forEach((key) => {
      const val = searchParams.get(key)
      if (val) setValue(key, val)
    })
  }, [searchParams, setValue])

  const onSubmit = async (data: WaitlistInput) => {
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const json = await res.json()

      if (json.ok) {
        if (json.alreadyOnWaitlist) {
          setAlreadyOnList(true)
        } else {
          setSubmitted(true)
        }
      } else {
        toast.error("Something went wrong. Please try again.")
      }
    } catch {
      toast.error("Something went wrong. Please try again.")
    }
  }

  const isDark = variant === "dark"

  if (submitted || alreadyOnList) {
    return (
      <div className="flex items-center gap-3 h-11">
        <CheckCircle
          className={cn("size-5 flex-shrink-0", isDark ? "text-white" : "text-violet")}
        />
        <p className={cn("text-sm font-medium", isDark ? "text-white" : "text-obsidian")}>
          {alreadyOnList
            ? "You're already on the list — we'll be in touch soon."
            : "You're on the list. Check your inbox."}
        </p>
      </div>
    )
  }

  return (
    <form
      id="waitlist"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-2 max-w-md"
    >
      <div className="flex gap-2">
        <input
          type="email"
          autoComplete="email"
          placeholder="Enter your work email"
          aria-label="Email address"
          aria-invalid={!!errors.email}
          className={cn(
            "flex-1 rounded-full px-4 h-11 text-sm outline-none border transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            isDark
              ? "bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/60"
              : "bg-white border-obsidian/15 text-obsidian placeholder:text-obsidian/40 focus:border-violet/50 focus:ring-2 focus:ring-violet/10",
          )}
          {...register("email")}
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(
            "flex-shrink-0 inline-flex items-center justify-center gap-2",
            "rounded-full px-5 h-11 text-sm font-medium",
            "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
            "active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed",
            isDark
              ? "bg-coral text-white hover:bg-coral/90"
              : "bg-violet text-white hover:bg-violet/90",
          )}
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Join waitlist"
          )}
        </button>
      </div>

      {errors.email && (
        <p className={cn("text-xs px-1", isDark ? "text-white/70" : "text-coral")}>
          {errors.email.message}
        </p>
      )}

      {/* Hidden UTM fields */}
      <input type="hidden" {...register("utm_source")} />
      <input type="hidden" {...register("utm_medium")} />
      <input type="hidden" {...register("utm_campaign")} />
      <input type="hidden" {...register("referrer")} />
    </form>
  )
}
