"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  acceptInviteAction,
  signUpAndAcceptAction,
  signOutForInviteAction,
} from "@/lib/db/actions/invites"

type InviteDisplay = {
  email: string
  role: string
  orgName: string
  branchName: string | null
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  inventory: "Inventory Manager",
  sales: "Sales",
  internal_use: "Internal Use",
}

const newUserSchema = z.object({
  fullName: z.string().min(2, "Enter your full name"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})
type NewUserInput = z.infer<typeof newUserSchema>

// ── Logged-in: email matches ─────────────────────────────────────────────────

function LoggedInMatchCard({
  token,
  invite,
}: {
  token: string
  invite: InviteDisplay
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setLoading(true)
    setError(null)
    const result = await acceptInviteAction(token)
    if (!result.ok) {
      const msgs: Record<string, string> = {
        not_found: "This invite was not found.",
        invalid: "This invite is no longer valid.",
        expired: "This invite has expired.",
        wrong_email: "Email mismatch — log out and sign in with the invited email.",
      }
      setError(msgs[result.code] ?? "Something went wrong. Please try again.")
      setLoading(false)
      return
    }
    router.push("/dashboard")
  }

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-8">
      <p className="text-xs font-mono text-neutral-400 uppercase tracking-wide">You&apos;re invited</p>
      <h1 className="mt-3 text-2xl font-semibold text-neutral-950">
        Join {invite.orgName}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        as <span className="font-medium text-neutral-700">{ROLE_LABELS[invite.role] ?? invite.role}</span>
        {invite.branchName ? ` · ${invite.branchName}` : ""}
      </p>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleAccept}
        disabled={loading}
        className="mt-6 w-full rounded-md bg-violet-700 text-white h-11 text-sm font-medium hover:bg-violet-800 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? "Joining…" : "Accept & join workspace"}
      </button>
    </div>
  )
}

// ── Logged-in: email mismatch ────────────────────────────────────────────────

function LoggedInMismatchCard({
  invite,
  currentEmail,
}: {
  invite: InviteDisplay
  currentEmail: string
}) {
  const [loading, setLoading] = useState(false)

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-8">
      <p className="text-xs font-mono text-neutral-400 uppercase tracking-wide">Wrong account</p>
      <h1 className="mt-3 text-xl font-semibold text-neutral-950">
        This invite is for a different account
      </h1>
      <div className="mt-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 space-y-1">
        <p>
          This invitation was sent to <span className="font-medium">{invite.email}</span>.
        </p>
        <p>
          You&apos;re currently signed in as <span className="font-medium">{currentEmail}</span>.
        </p>
      </div>
      <p className="mt-3 text-sm text-neutral-500">
        Log out and sign in with <span className="font-medium text-neutral-700">{invite.email}</span> to accept this invitation.
      </p>
      <button
        type="button"
        disabled={loading}
        onClick={async () => { setLoading(true); await signOutForInviteAction() }}
        className="mt-6 w-full rounded-md bg-neutral-950 text-white h-11 text-sm font-medium hover:bg-neutral-800 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? "Signing out…" : "Sign out"}
      </button>
    </div>
  )
}

// ── Not logged in: sign up + accept ─────────────────────────────────────────

function NewUserCard({
  token,
  invite,
}: {
  token: string
  invite: InviteDisplay
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<NewUserInput>({ resolver: zodResolver(newUserSchema) })

  async function onSubmit(data: NewUserInput) {
    setServerError(null)
    const result = await signUpAndAcceptAction(token, invite.email, data.fullName, data.password)
    if (!result.ok) {
      if (result.code === "account_exists") {
        setServerError("An account with this email already exists. Log in below to accept the invite.")
        return
      }
      if (result.code === "wrong_email") {
        setServerError("Email mismatch — contact the person who invited you.")
        return
      }
      setServerError("Something went wrong. Please try again.")
      return
    }
    router.push("/dashboard")
  }

  return (
    <div className="bg-white rounded-xl border border-neutral-200 p-8">
      <p className="text-xs font-mono text-neutral-400 uppercase tracking-wide">You&apos;re invited</p>
      <h1 className="mt-3 text-2xl font-semibold text-neutral-950">
        Join {invite.orgName}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        as <span className="font-medium text-neutral-700">{ROLE_LABELS[invite.role] ?? invite.role}</span>
        {invite.branchName ? ` · ${invite.branchName}` : ""}
      </p>
      <p className="mt-1 text-xs text-neutral-400">Create your account to get started.</p>

      {serverError && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={invite.email}
            disabled
            readOnly
            className="bg-neutral-50 text-neutral-400 cursor-not-allowed"
          />
          <p className="text-xs text-neutral-400">This email is set by the invite and cannot be changed.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            type="text"
            autoComplete="name"
            placeholder="Ada Okonkwo"
            aria-invalid={!!errors.fullName}
            {...register("fullName")}
          />
          {errors.fullName && (
            <p className="text-xs text-red-600">{errors.fullName.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Choose a password (8+ chars)"
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
          className="mt-2 w-full rounded-md bg-violet-700 text-white h-11 text-sm font-medium hover:bg-violet-800 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Creating account…" : "Create account & join"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Already have an account?{" "}
        <a
          href={`/login?next=/accept-invite/${token}`}
          className="text-neutral-950 font-medium hover:underline underline-offset-2"
        >
          Log in to accept
        </a>
      </p>
    </div>
  )
}

// ── Root component ───────────────────────────────────────────────────────────

export function AcceptForm({
  token,
  invite,
  currentEmail,
}: {
  token: string
  invite: InviteDisplay
  currentEmail: string | null
}) {
  const isLoggedIn = !!currentEmail

  if (!isLoggedIn) {
    return <NewUserCard token={token} invite={invite} />
  }

  const emailMatches =
    currentEmail.toLowerCase() === invite.email.toLowerCase()

  if (emailMatches) {
    return <LoggedInMatchCard token={token} invite={invite} />
  }

  return <LoggedInMismatchCard invite={invite} currentEmail={currentEmail} />
}
