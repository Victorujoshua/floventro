import { signOutAction } from "@/lib/auth/actions"

export async function POST() {
  await signOutAction()
}

export async function GET() {
  // GET allowed for dev convenience (visiting /logout in browser).
  // In production this should be POST-only for CSRF safety.
  await signOutAction()
}
