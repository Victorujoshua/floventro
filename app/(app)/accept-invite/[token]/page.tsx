import Link from "next/link"
import { getInviteByToken } from "@/lib/db/queries/invites"
import { createAppServerClient } from "@/lib/supabase/app-server"
import { AcceptForm } from "./accept-form"

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const invite = await getInviteByToken(token)

  if (invite.status === "not_found") {
    return <ErrorCard title="Invitation not found" description="This invite link doesn't exist or has already been deleted." />
  }

  if (invite.status === "used") {
    return <ErrorCard title="Invitation already used" description="This invitation has already been accepted. Log in to access your workspace." showLogin />
  }

  if (invite.status === "expired") {
    return <ErrorCard title="Invitation expired" description="This invitation link has expired. Ask your team owner to send a new one." />
  }

  const supabase = await createAppServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  const currentEmail = user?.email ?? null

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/asset/logo.svg" alt="Floventro" className="h-8" />
        </div>
        <AcceptForm
          token={token}
          invite={{
            email: invite.email,
            role: invite.role,
            orgName: invite.orgName,
            branchName: invite.branchName,
          }}
          currentEmail={currentEmail}
        />
      </div>
    </div>
  )
}

function ErrorCard({
  title,
  description,
  showLogin,
}: {
  title: string
  description: string
  showLogin?: boolean
}) {
  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/asset/logo.svg" alt="Floventro" className="h-8" />
        </div>
        <div className="bg-white rounded-xl border border-neutral-200 p-8 text-center">
          <p className="text-lg font-semibold text-neutral-950">{title}</p>
          <p className="mt-2 text-sm text-neutral-500">{description}</p>
          {showLogin && (
            <Link
              href="/login"
              className="mt-6 inline-flex items-center justify-center w-full rounded-md bg-violet-700 text-white h-11 text-sm font-medium hover:bg-violet-800 transition-colors"
            >
              Go to login
            </Link>
          )}
          {!showLogin && (
            <Link
              href="/login"
              className="mt-6 inline-block text-sm text-neutral-500 hover:text-neutral-800 underline-offset-2 hover:underline"
            >
              Back to login
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
