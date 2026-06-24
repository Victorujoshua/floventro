import { NextRequest, NextResponse } from "next/server"
import { waitlistSchema } from "@/lib/validation/waitlist"
import { createServerSupabase } from "@/lib/supabase/server"
import { addWaitlistContact, sendWaitlistConfirmation } from "@/lib/email/loops"

// In-memory rate limit: 5 requests per minute per IP.
// Per-instance only — acceptable for a low-traffic waitlist endpoint.
type RateLimitEntry = { count: number; resetAt: number }
const rateLimitMap = new Map<string, RateLimitEntry>()
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60_000

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }

  if (entry.count >= RATE_LIMIT_MAX) return true

  entry.count++
  return false
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "127.0.0.1"
  )
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)

  if (isRateLimited(ip)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 })
  }

  const result = waitlistSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 })
  }

  const { email, fullName, company, role, branchCount, referrer, utm_source, utm_medium, utm_campaign } =
    result.data

  const supabase = createServerSupabase()

  const { error } = await supabase.from("waitlist").insert({
    email,
    full_name: fullName ?? null,
    company: company ?? null,
    role: role ?? null,
    branch_count: branchCount ?? null,
    referrer: referrer ?? null,
    utm_source: utm_source ?? null,
    utm_medium: utm_medium ?? null,
    utm_campaign: utm_campaign ?? null,
  })

  if (error) {
    // Postgres unique violation — already on the waitlist
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, alreadyOnWaitlist: true })
    }

    console.error("[waitlist] insert error:", error.message)
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 })
  }

  const firstName = fullName?.split(" ")[0]

  // Fire-and-forget — failures are logged but don't affect the user response
  addWaitlistContact({ email, firstName, company, role, branchCount }).then((r) => {
    if (!r.ok) console.error("[waitlist] loops contact add failed for", email)
  })

  sendWaitlistConfirmation(email, firstName).then((r) => {
    if (!r.ok) console.error("[waitlist] loops confirmation failed for", email)
  })

  return NextResponse.json({ ok: true })
}
