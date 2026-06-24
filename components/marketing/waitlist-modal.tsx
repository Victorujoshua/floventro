"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Dialog } from "@base-ui/react/dialog"
import { track } from "@vercel/analytics"
import { cn } from "@/lib/utils"
import { waitlistSchema, type WaitlistInput } from "@/lib/validation/waitlist"

// ── Modal context ──────────────────────────────────────────────────────────────

const WaitlistModalCtx = createContext<{
  open: boolean
  setOpen: (open: boolean) => void
}>({ open: false, setOpen: () => {} })

export function useWaitlistModal() {
  return useContext(WaitlistModalCtx)
}

export function WaitlistModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <WaitlistModalCtx.Provider value={{ open, setOpen }}>
      {children}
      <WaitlistModalDialog open={open} onOpenChange={setOpen} />
    </WaitlistModalCtx.Provider>
  )
}

// ── Internal dialog ────────────────────────────────────────────────────────────

type Status = "idle" | "loading" | "success" | "duplicate" | "error"

function WaitlistModalDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [status, setStatus] = useState<Status>("idle")

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<WaitlistInput>({ resolver: zodResolver(waitlistSchema) })

  // Reset form status after close animation finishes
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => setStatus("idle"), 300)
      return () => clearTimeout(t)
    }
  }, [open])

  // Read UTMs from URL on open, persist in sessionStorage
  useEffect(() => {
    if (!open || typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    ;(["utm_source", "utm_medium", "utm_campaign"] as const).forEach((key) => {
      const v = params.get(key) ?? sessionStorage.getItem(`fv_${key}`) ?? ""
      if (v) {
        sessionStorage.setItem(`fv_${key}`, v)
        setValue(key, v)
      }
    })
  }, [open, setValue])

  const onSubmit = async (data: WaitlistInput) => {
    setStatus("loading")
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const json = (await res.json()) as { ok: boolean; alreadyOnWaitlist?: boolean }
      if (!res.ok || !json.ok) {
        setStatus("error")
        return
      }
      if (!json.alreadyOnWaitlist) {
        track("waitlist_signup", { source: data.utm_source ?? "direct" })
      }
      setStatus(json.alreadyOnWaitlist ? "duplicate" : "success")
    } catch {
      setStatus("error")
    }
  }

  const succeeded = status === "success" || status === "duplicate"

  return (
    <Dialog.Root open={open} onOpenChange={(v) => onOpenChange(v)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none",
            "max-w-[min(448px,calc(100vw-2rem))]",
            "rounded-xl bg-cream border border-warm p-8",
            "shadow-[0_8px_40px_-8px_rgba(21,29,39,0.18)]",
            "duration-[250ms] ease-[var(--ease-out)]",
            "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-2",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-2",
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="font-sans font-bold text-display-3 text-ink leading-tight">
              Join the waitlist.
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="mt-1 flex-shrink-0 text-2xl leading-none text-ink-muted hover:text-ink transition-colors duration-[var(--duration-fast)]"
            >
              ×
            </Dialog.Close>
          </div>

          <p className="mt-2 text-body text-ink-muted">
            Be among the first businesses to get access when we launch.{/* TODO(copy) */}
          </p>

          {succeeded ? (
            <div className="mt-6">
              <p className="text-body font-medium text-ink">
                {status === "duplicate"
                  ? "You're already on the list — we'll be in touch."
                  : "You're on the list. Check your inbox."}
              </p>
              <p className="mt-1 font-mono text-mono-eyebrow text-ink-muted">
                we'll only email about Floventro
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="mt-6" noValidate>
              <input
                type="email"
                autoComplete="email"
                placeholder="Work email"
                aria-label="Email address"
                aria-invalid={!!errors.email}
                className="w-full bg-white border border-warm rounded-md h-11 px-3 text-sm text-ink placeholder:text-ink-muted/60 outline-none focus:border-ink/40 transition-colors duration-[var(--duration-fast)]"
                {...register("email")}
              />

              {errors.email && (
                <p className="mt-1 text-body-sm text-red-600">{errors.email.message}</p>
              )}
              {status === "error" && (
                <p className="mt-1 text-body-sm text-red-600">
                  Something went wrong. Please try again.
                </p>
              )}

              {/* Hidden UTM fields */}
              <input type="hidden" {...register("utm_source")} />
              <input type="hidden" {...register("utm_medium")} />
              <input type="hidden" {...register("utm_campaign")} />

              <button
                type="submit"
                disabled={status === "loading"}
                className="mt-3 w-full bg-brand-violet text-white rounded-none h-11 text-sm font-medium hover:bg-brand-violet/90 active:scale-[0.98] transition-all duration-[var(--duration-fast)] ease-[var(--ease-out)] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {status === "loading" ? "Adding you…" : "Join Waitlist →"}
              </button>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
