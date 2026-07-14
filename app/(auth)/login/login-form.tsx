"use client"

import { useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signInSchema, type SignInInput } from "@/lib/validation/auth"
import { signInAction } from "@/lib/auth/actions"

export function LoginForm({ next }: { next?: string }) {
  const [invalidCredentials, setInvalidCredentials] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) })

  const onSubmit = async (data: SignInInput) => {
    setInvalidCredentials(false)
    const result = await signInAction(data, next)

    if (!result.ok) {
      if (result.code === "invalid_credentials") {
        setInvalidCredentials(true)
        return
      }
      toast.error("Something went wrong. Please try again.")
    }
  }

  return (
    <div className="bg-white rounded-xl border border-neutral-300 p-8">
      <h1 className="text-2xl font-semibold text-neutral-950">Log in</h1>
      <p className="text-sm text-neutral-500 mt-1">Welcome back to Floventro.</p>

      {invalidCredentials && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Wrong email or password.
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

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Your password"
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

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 w-full bg-violet text-white rounded-md h-11 text-sm font-medium hover:bg-violet/90 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-neutral-950 font-medium hover:underline underline-offset-2">
          Sign up
        </Link>
      </p>
    </div>
  )
}
