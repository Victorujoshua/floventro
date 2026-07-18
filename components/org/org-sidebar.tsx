"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useState } from "react"
import {
  LayoutDashboard,
  ShoppingCart,
  BookOpen,
  Plus,
  LogIn,
  LogOut,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { enterBranchAction } from "@/lib/db/actions/org"
import type { BranchRow } from "@/lib/db/queries/branches"

const ORG_NAV = [
  { label: "Overview",        href: "/org",         icon: LayoutDashboard },
  { label: "Sales & Revenue", href: "/org/sales",   icon: ShoppingCart },
  { label: "Org Ledger",      href: "/org/ledger",  icon: BookOpen },
]

type Props = {
  orgName: string
  branches: BranchRow[]
}

export function OrgSidebar({ orgName, branches }: Props) {
  const pathname = usePathname()
  const [enteringId, setEnteringId] = useState<string | null>(null)

  async function handleEnter(branchId: string) {
    if (enteringId) return
    setEnteringId(branchId)
    const result = await enterBranchAction(branchId)
    if (result.ok) {
      window.location.href = "/dashboard"
    } else {
      setEnteringId(null)
    }
  }

  return (
    <aside className="fixed left-0 top-0 z-30 flex h-screen w-60 flex-col border-r border-neutral-200 bg-white">
      {/* Logo + org context */}
      <div className="px-5 py-5">
        <Image
          src="/asset/logo.svg"
          alt="Floventro"
          width={120}
          height={24}
          unoptimized
          priority
        />
        <p className="mt-2.5 text-xs text-neutral-400 font-medium truncate">{orgName}</p>
        <span className="mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-violet-700 bg-tint-violet border border-violet-200/50">
          Owner
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {/* Organization section */}
        <p className="px-2 mb-2 mt-1 text-[11px] tracking-wider text-neutral-400 font-medium uppercase">
          Organization
        </p>
        <div className="space-y-0.5">
          {ORG_NAV.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-2 py-2 text-sm transition-colors",
                  active
                    ? "bg-tint-violet text-violet-700 font-medium"
                    : "text-neutral-600 hover:bg-neutral-50",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                    active ? "bg-white shadow-sm" : "",
                  )}
                >
                  <item.icon
                    className={cn("h-4 w-4", active ? "text-violet-700" : "text-neutral-400")}
                  />
                </span>
                {item.label}
              </Link>
            )
          })}
        </div>

        {/* Branches section */}
        <p className="px-2 mb-2 mt-6 text-[11px] tracking-wider text-neutral-400 font-medium uppercase">
          Branches
        </p>
        <div className="space-y-0.5">
          {branches.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-1.5 rounded-xl px-2 py-1.5"
            >
              <span className="flex-1 min-w-0 text-sm text-neutral-700 truncate">{b.name}</span>
              <button
                onClick={() => handleEnter(b.id)}
                disabled={enteringId !== null}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2 h-7 text-xs font-medium transition-colors",
                  enteringId === b.id
                    ? "text-violet-700 border-violet-200 bg-tint-violet"
                    : "text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                <LogIn className="h-3 w-3" />
                {enteringId === b.id ? "…" : "Enter"}
              </button>
            </div>
          ))}

          <Link
            href="/admin/branches"
            className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600 transition-colors"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
              <Plus className="h-4 w-4" />
            </span>
            Add branch
          </Link>
        </div>
      </nav>

      {/* Log out */}
      <div className="border-t border-neutral-200 px-3 py-3">
        <a
          href="/logout"
          className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
            <LogOut className="h-4 w-4 text-neutral-400" />
          </span>
          Log out
        </a>
      </div>
    </aside>
  )
}
