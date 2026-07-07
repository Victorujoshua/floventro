import type { Role } from "@/lib/auth/scope"

type Props = {
  orgName: string
  role: Role
}

export function AppHeader({ orgName, role }: Props) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-8">
      <div />
      <span className="text-sm text-neutral-500">
        {orgName} · {role}
      </span>
    </header>
  )
}
