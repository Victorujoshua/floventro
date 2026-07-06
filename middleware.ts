import { type NextRequest } from "next/server"
import { updateAppSession } from "@/lib/supabase/app-middleware"

export async function middleware(request: NextRequest) {
  return await updateAppSession(request)
}

export const config = {
  matcher: [
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
