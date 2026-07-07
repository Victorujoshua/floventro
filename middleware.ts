import { NextResponse, type NextRequest } from "next/server"
import { updateAppSession } from "@/lib/supabase/app-middleware"

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? ""
  const { pathname } = request.nextUrl

  const isAppDomain = host.startsWith("app.")
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1")

  // Marketing domain: do nothing at all. Never touch Supabase here —
  // the marketing Vercel project doesn't have the app env vars.
  if (!isAppDomain && !isLocalhost) {
    return NextResponse.next()
  }

  // App root → login
  if (isAppDomain && pathname === "/") {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Extra safety: if app env vars are missing, skip session refresh instead of crashing
  if (!process.env.NEXT_PUBLIC_APP_SUPABASE_URL || !process.env.NEXT_PUBLIC_APP_SUPABASE_ANON_KEY) {
    return NextResponse.next()
  }

  // Don't run session refresh on marketing-only paths when developing locally
  if (isLocalhost && pathname === "/") {
    return NextResponse.next()
  }

  return await updateAppSession(request)
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/inventory/:path*",
    "/sales/:path*",
    "/internal-use/:path*",
    "/admin/:path*",
    "/onboarding/:path*",
    "/accept-invite/:path*",
    "/login",
    "/signup",
    "/logout",
  ],
}
