"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signUpSchema, type SignUpInput } from "@/lib/validation/auth"
import { signUpAction } from "@/lib/auth/actions"

export default function SignUpPage() {
  const router = useRouter()
  const [accountExists, setAccountExists] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) })

  const onSubmit = async (data: SignUpInput) => {
    setAccountExists(false)
    const result = await signUpAction(data)

    if (!result.ok) {
      if (result.code === "account_exists") {
        setAccountExists(true)
        return
      }
      toast.error("Something went wrong. Please try again.")
      return
    }

    router.push("/onboarding/create-org")
  }

  return (
    <div className="bg-white rounded-xl border border-neutral-300 p-8">
      <h1 className="text-2xl font-semibold text-neutral-950">Create your account</h1>
      <p className="text-sm text-neutral-500 mt-1">Set up Floventro for your business.</p>

      {accountExists && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          An account with this email already exists.{" "}
          <Link href="/login" className="font-medium underline underline-offset-2">
            Log in instead?
          </Link>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            type="text"
            autoComplete="name"
            placeholder="Ada Okafor"
            aria-invalid={!!errors.fullName}
            {...register("fullName")}
          />
          {errors.fullName && (
            <p className="text-xs text-red-600">{errors.fullName.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
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

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 w-full bg-violet text-white rounded-md h-11 text-sm font-medium hover:bg-violet/90 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Already have an account?{" "}
        <Link href="/login" className="text-neutral-950 font-medium hover:underline underline-offset-2">
          Log in
        </Link>
      </p>
    </div>
  )
}
