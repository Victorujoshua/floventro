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
  LogOut,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Role } from "@/lib/auth/scope"

type NavItem = {
  label: string
  href: string
  icon: React.ElementType
  badge?: number
}

const MAIN_MENU: Record<Role, NavItem[]> = {
  owner: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Products", href: "/inventory/products", icon: Package },
    { label: "Vendors", href: "/inventory/vendors", icon: Truck },
    { label: "Invoices", href: "/inventory/invoices", icon: FileText },
  ],
  inventory: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Products", href: "/inventory/products", icon: Package },
    { label: "Vendors", href: "/inventory/vendors", icon: Truck },
    { label: "Invoices", href: "/inventory/invoices", icon: FileText },
  ],
  sales: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  internal_use: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
}

const MANAGEMENT_MENU: NavItem[] = [
  { label: "Team", href: "/admin/team", icon: Users },
  { label: "Settings", href: "/admin/settings", icon: SettingsIcon },
]

function NavBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="ml-auto flex min-w-5 h-5 items-center justify-center rounded-full bg-violet-700 text-white text-[11px] px-1.5 font-medium leading-none">
      {count > 99 ? "99+" : count}
    </span>
  )
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
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
      {item.badge !== undefined && <NavBadge count={item.badge} />}
    </Link>
  )
}

type Props = {
  role: Role
  pastDueCount: number
}

export function Sidebar({ role, pastDueCount }: Props) {
  const pathname = usePathname()

  const mainItems = (MAIN_MENU[role] ?? MAIN_MENU.owner).map((item) =>
    item.href === "/inventory/invoices" ? { ...item, badge: pastDueCount } : item,
  )
  const showManagement = role === "owner"

  return (
    <aside className="fixed left-0 top-0 z-30 flex h-screen w-60 flex-col border-r border-neutral-200 bg-white">
      {/* Logo */}
      <div className="px-5 py-5">
        <Image
          src="/asset/logo.svg"
          alt="Floventro"
          width={120}
          height={24}
          unoptimized
          priority
        />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        <p className="px-2 mb-2 mt-1 text-[11px] tracking-wider text-neutral-400 font-medium uppercase">
          Main Menu
        </p>
        <div className="space-y-0.5">
          {mainItems.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={pathname === item.href || pathname.startsWith(item.href + "/")}
            />
          ))}
        </div>

        {showManagement && (
          <>
            <p className="px-2 mb-2 mt-6 text-[11px] tracking-wider text-neutral-400 font-medium uppercase">
              Management
            </p>
            <div className="space-y-0.5">
              {MANAGEMENT_MENU.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={pathname === item.href || pathname.startsWith(item.href + "/")}
                />
              ))}
            </div>
          </>
        )}
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
