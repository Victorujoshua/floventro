import { redirect, notFound } from "next/navigation"
import { createAppServerClient } from "@/lib/supabase/app-server"

// Dev/preview only — never ships to production users.
// Set NEXT_PUBLIC_APP_ENV=production on the Vercel app project to disable.
export default async function DebugRlsPage() {
  if (process.env.NEXT_PUBLIC_APP_ENV === "production") {
    notFound()
  }

  const supabase = await createAppServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const [{ data: orgs, error: orgsError }, { data: branches, error: branchesError }, { data: memberships, error: membershipsError }] =
    await Promise.all([
      supabase.from("organisations").select("id, name"),
      supabase.from("branches").select("id, name, organisation_id"),
      supabase.from("memberships").select("id, organisation_id, branch_id, role, deleted_at"),
    ])

  return (
    <div style={{ fontFamily: "monospace", padding: "2rem", maxWidth: "800px" }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>RLS Debug</h1>
      <p style={{ color: "#666", marginBottom: "2rem" }}>
        Queries run via anon key + your session cookie — same path as the real app. This page is
        disabled when NEXT_PUBLIC_APP_ENV=production.
      </p>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
          Authenticated user
        </h2>
        <pre style={{ background: "#f4f4f4", padding: "1rem", borderRadius: "4px" }}>
          {JSON.stringify({ id: user.id, email: user.email }, null, 2)}
        </pre>
      </section>

      <Section
        title={`Organisations (${orgs?.length ?? 0})`}
        data={orgs}
        error={orgsError?.message}
      />
      <Section
        title={`Branches (${branches?.length ?? 0})`}
        data={branches}
        error={branchesError?.message}
      />
      <Section
        title={`Memberships (${memberships?.length ?? 0})`}
        data={memberships}
        error={membershipsError?.message}
      />
    </div>
  )
}

function Section({
  title,
  data,
  error,
}: {
  title: string
  data: unknown[] | null
  error?: string
}) {
  return (
    <section style={{ marginBottom: "2rem" }}>
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>{title}</h2>
      {error ? (
        <pre style={{ background: "#fee", padding: "1rem", borderRadius: "4px", color: "#c00" }}>
          ERROR: {error}
        </pre>
      ) : (
        <pre style={{ background: "#f4f4f4", padding: "1rem", borderRadius: "4px", overflow: "auto" }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </section>
  )
}
