"use client"

import { createBrowserClient } from "@supabase/ssr"

export function createAppBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_APP_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_APP_SUPABASE_ANON_KEY!,
  )
}
