// Hand-authored from supabase/migrations/0001_waitlist.sql
// Regenerate with: pnpm dlx supabase gen types typescript --project-id $SUPABASE_PROJECT_ID > types/supabase.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      waitlist: {
        Row: {
          id: string
          email: string
          full_name: string | null
          company: string | null
          role: string | null
          branch_count: string | null
          referrer: string | null
          utm_source: string | null
          utm_medium: string | null
          utm_campaign: string | null
          created_at: string
          confirmed_at: string | null
        }
        Insert: {
          id?: string
          email: string
          full_name?: string | null
          company?: string | null
          role?: string | null
          branch_count?: string | null
          referrer?: string | null
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          created_at?: string
          confirmed_at?: string | null
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          company?: string | null
          role?: string | null
          branch_count?: string | null
          referrer?: string | null
          utm_source?: string | null
          utm_medium?: string | null
          utm_campaign?: string | null
          created_at?: string
          confirmed_at?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
