import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

// Cookie-aware client — uses anon key, respects RLS.
// Use in server components and server actions.
export async function createAppServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_APP_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_APP_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component — cookie writes are ignored safely.
          }
        },
      },
    },
  )
}

// Service-role client — bypasses RLS. Use ONLY in server-only code for
// privileged operations (RPCs, invite acceptance, admin tasks).
export function createAppServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_APP_SUPABASE_URL!,
    process.env.APP_SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
}
