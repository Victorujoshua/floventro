"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validation/auth"
import { resetPasswordAction } from "@/lib/auth/actions"

export function ResetPasswordForm({ email }: { email: string }) {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) })

  const onSubmit = async (data: ResetPasswordInput) => {
    const result = await resetPasswordAction(data)

    if (!result.ok) {
      if (result.code === "session_missing") {
        router.push("/forgot-password?error=session_missing")
        return
      }
      if (result.code === "same_password") {
        setError("password", { message: "Choose a password different from your current one" })
        return
      }
      if (result.code === "weak_password") {
        setError("password", { message: "That password is too weak. Try a longer one" })
        return
      }
      toast.error("Something went wrong. Please try again.")
    }
  }

  return (
    <div className="bg-white rounded-xl border border-neutral-300 p-8">
      <h1 className="text-2xl font-semibold text-neutral-950">Set a new password</h1>
      <p className="text-sm text-neutral-500 mt-1">
        {email ? (
          <>
            For <span className="text-neutral-950 font-medium">{email}</span>.
          </>
        ) : (
          "Choose a new password for your account."
        )}
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Min. 8 characters"
              aria-invalid={!!errors.password}
              className="pr-10"
              {...register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-red-600">{errors.password.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            aria-invalid={!!errors.confirmPassword}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-red-600">{errors.confirmPassword.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 w-full bg-violet text-white rounded-md h-11 text-sm font-medium hover:bg-violet/90 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Updating password…" : "Update password"}
        </button>
      </form>
    </div>
  )
}
