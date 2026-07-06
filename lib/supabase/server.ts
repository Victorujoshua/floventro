import { createClient } from "@supabase/supabase-js"
import { createServerClient as _createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

// Landing page waitlist DB — untyped intentionally.
// types/supabase.ts now belongs to the app DB; the waitlist DB is a separate project.
export function createServerSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Cookie-based client — uses anon key, respects RLS. For auth-aware server components.
export async function createServerClient() {
  const cookieStore = await cookies()

  return _createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        },
      },
    },
  )
}
