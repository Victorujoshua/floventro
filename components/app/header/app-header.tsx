"use client"

import Link from "next/link"
import { Bell, ChevronDown, LogOut, Settings, ExternalLink, ChevronLeft } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { setScopeAction } from "@/lib/db/actions/scope"
import { clearBranchAction } from "@/lib/db/actions/org"

export type NotificationItem = {
  id: string
  kind: "past_due" | "low_stock" | "pending_requests"
  title: string
  detail: string
  href?: string
}

export type WorkspaceMembership = {
  id: string
  organisationId: string
  branchId: string | null
  role: string
  orgName: string
  branchName: string | null
}

type Props = {
  orgName: string
  branchId: string | null
  branchName: string
  role: string
  userName: string
  userEmail: string
  notifications: NotificationItem[]
  memberships: WorkspaceMembership[]
}

export function AppHeader({
  orgName,
  branchId,
  branchName,
  role,
  userName,
  userEmail,
  notifications,
  memberships,
}: Props) {
  const displayName = userName || userEmail
  const initials = displayName.charAt(0).toUpperCase()
  const hasAlerts = notifications.length > 0
  const isOwnerInBranch = role === "owner" && branchId !== null

  async function switchScope(m: WorkspaceMembership) {
    await setScopeAction(m.organisationId, m.branchId, m.role)
    window.location.href = "/dashboard"
  }

  async function handleBackToOrg() {
    await clearBranchAction()
    window.location.href = "/org"
  }

  return (
    <header className="sticky top-0 z-20 h-16 bg-white border-b border-neutral-200 px-8 flex items-center justify-between">
      {/* Left slot — branch name + back-to-org for owners in a branch */}
      <div className="flex items-center gap-3 min-w-0">
        {isOwnerInBranch ? (
          <>
            <button
              onClick={handleBackToOrg}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors shrink-0"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back to organization
            </button>
            <span className="text-neutral-300 hidden sm:block">|</span>
            <span className="text-sm font-medium text-neutral-950 truncate hidden sm:block">
              {branchName}
            </span>
          </>
        ) : (
          <div />
        )}
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="relative rounded-lg bg-neutral-100 hover:bg-neutral-200 p-2 transition-colors"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4 text-neutral-700" />
            {hasAlerts && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 p-0">
            <div className="px-3 py-2.5 border-b border-neutral-100">
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Alerts
              </p>
            </div>
            {notifications.length === 0 ? (
              <div className="px-3 py-5 text-center">
                <p className="text-sm text-neutral-500">You&apos;re all caught up.</p>
              </div>
            ) : (
              <div>
                {notifications.map((n) =>
                  n.href ? (
                    <Link
                      key={n.id}
                      href={n.href}
                      className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-neutral-50 last:border-0 hover:bg-neutral-50 transition-colors"
                    >
                      <span className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-sm font-medium text-neutral-900 leading-snug">
                          {n.title}
                        </span>
                        <span className="text-xs text-neutral-500">{n.detail}</span>
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-neutral-400 shrink-0 mt-0.5" />
                    </Link>
                  ) : (
                    <div
                      key={n.id}
                      className="flex flex-col gap-0.5 px-3 py-2.5 border-b border-neutral-50 last:border-0 hover:bg-neutral-50 transition-colors"
                    >
                      <span className="text-sm font-medium text-neutral-900 leading-snug">
                        {n.title}
                      </span>
                      <span className="text-xs text-neutral-500">{n.detail}</span>
                    </div>
                  ),
                )}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Profile chip */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-2.5 py-1.5 hover:bg-neutral-50 transition-colors">
            <div className="w-7 h-7 rounded-full bg-violet-700 text-white grid place-items-center text-xs font-semibold shrink-0">
              {initials}
            </div>
            <span className="text-sm font-medium text-neutral-900 hidden sm:block max-w-[120px] truncate">
              {displayName}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-64 p-0">
            {/* Identity header */}
            <div className="px-3 py-3 border-b border-neutral-100">
              <p className="text-sm font-semibold text-neutral-950 truncate">{displayName}</p>
              <p className="text-xs text-neutral-500 truncate">{userEmail}</p>
              <p className="text-xs text-neutral-400 mt-0.5 capitalize">{role} · {orgName}</p>
            </div>

            {/* Switch workspace */}
            {memberships.length > 1 && (
              <>
                <div className="px-3 pt-2 pb-1">
                  <p className="text-[11px] text-neutral-400 font-medium uppercase tracking-wider">
                    Switch workspace
                  </p>
                </div>
                {memberships.map((m) => (
                  <DropdownMenuItem
                    key={`${m.organisationId}-${m.branchId ?? "null"}-${m.role}`}
                    className="mx-1 gap-0 flex-col items-start cursor-pointer"
                    onClick={() => switchScope(m)}
                  >
                    <span className="text-sm font-medium text-neutral-900">
                      {m.orgName || orgName}
                    </span>
                    <span className="text-xs text-neutral-400">
                      {m.branchName ? `${m.branchName} · ` : ""}{m.role}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}

            <div className="p-1">
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => { window.location.href = "/admin/settings" }}
              >
                <Settings className="h-4 w-4 text-neutral-500 mr-2" />
                Settings
              </DropdownMenuItem>
            </div>

            <DropdownMenuSeparator />

            <div className="p-1">
              <DropdownMenuItem
                className="cursor-pointer text-red-600 focus:text-red-600"
                variant="destructive"
                onClick={() => { window.location.href = "/logout" }}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Log out
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
