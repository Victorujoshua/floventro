"use client"

import { useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validation/auth"
import { requestPasswordResetAction } from "@/lib/auth/actions"

const LINK_ERRORS: Record<string, string> = {
  invalid_link: "That reset link is invalid or has expired. Request a new one below.",
  session_missing: "Your reset session has expired. Request a new link below.",
}

export function ForgotPasswordForm({ linkError }: { linkError?: string }) {
  const [sentTo, setSentTo] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) })

  const onSubmit = async (data: ForgotPasswordInput) => {
    const result = await requestPasswordResetAction(data)

    if (!result.ok) {
      toast.error("Something went wrong. Please try again.")
      return
    }

    setSentTo(data.email)
  }

  if (sentTo) {
    return (
      <div className="bg-white rounded-xl border border-neutral-300 p-8">
        <h1 className="text-2xl font-semibold text-neutral-950">Check your email</h1>
        <p className="text-sm text-neutral-500 mt-1">
          If an account exists for <span className="text-neutral-950 font-medium">{sentTo}</span>,
          we&apos;ve sent a link to reset your password. The link expires in 1 hour.
        </p>

        <p className="mt-6 text-center text-sm text-neutral-500">
          <Link href="/login" className="text-neutral-950 font-medium hover:underline underline-offset-2">
            Back to log in
          </Link>
        </p>
      </div>
    )
  }

  const linkErrorMessage = linkError ? LINK_ERRORS[linkError] : undefined

  return (
    <div className="bg-white rounded-xl border border-neutral-300 p-8">
      <h1 className="text-2xl font-semibold text-neutral-950">Forgot password?</h1>
      <p className="text-sm text-neutral-500 mt-1">
        Enter your email and we&apos;ll send you a link to reset it.
      </p>

      {linkErrorMessage && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {linkErrorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="ada@company.com"
            aria-invalid={!!errors.email}
            {...register("email")}
          />
          {errors.email && (
            <p className="text-xs text-red-600">{errors.email.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 w-full bg-violet text-white rounded-md h-11 text-sm font-medium hover:bg-violet/90 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Remembered it?{" "}
        <Link href="/login" className="text-neutral-950 font-medium hover:underline underline-offset-2">
          Log in
        </Link>
      </p>
    </div>
  )
}
