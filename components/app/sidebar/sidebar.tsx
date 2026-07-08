"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Package,
  Truck,
  FileText,
  Users,
  Settings as SettingsIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Role } from "@/lib/auth/scope"

type NavItem = {
  label: string
  href: string
  icon: React.ElementType
}

const NAV: Record<Role, NavItem[]> = {
  owner: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Products", href: "/inventory/products", icon: Package },
    { label: "Vendors", href: "/inventory/vendors", icon: Truck },
    { label: "Invoices", href: "/inventory/invoices/new", icon: FileText },
    { label: "Team", href: "/admin/team", icon: Users },
    { label: "Settings", href: "/admin/settings", icon: SettingsIcon },
  ],
  inventory: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Products", href: "/inventory/products", icon: Package },
    { label: "Vendors", href: "/inventory/vendors", icon: Truck },
    { label: "Invoices", href: "/inventory/invoices/new", icon: FileText },
  ],
  sales: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  ],
  internal_use: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  ],
}

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname()
  const items = NAV[role] ?? NAV.owner

  return (
    <aside className="fixed left-0 top-0 z-30 flex h-screen w-60 flex-col border-r border-neutral-200 bg-white">
      {/* Logo */}
      <div className="px-5 py-5">
        <Image src="/asset/logo.svg" alt="Floventro" width={120} height={24} unoptimized priority />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/")
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md py-2.5 text-sm transition-colors",
                active
                  ? "border-l-2 border-violet-700 bg-neutral-100 pl-[calc(1.25rem-2px)] font-medium text-violet-700"
                  : "pl-5 text-neutral-700 hover:bg-neutral-50",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="border-t border-neutral-200 px-5 py-4">
        <a
          href="/logout"
          className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          Log out
        </a>
      </div>
    </aside>
  )
}
