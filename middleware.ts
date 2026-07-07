import { NextResponse, type NextRequest } from "next/server"
import { updateAppSession } from "@/lib/supabase/app-middleware"

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? ""
  const { pathname } = request.nextUrl

  if (host.startsWith("app.") && pathname === "/") {
    return NextResponse.redirect(new URL("/login", request.url))
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
