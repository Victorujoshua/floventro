"use client"

import { useState } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import {
  Package,
  Clock,
  Bell,
  MapPin,
  Building2,
  Calendar,
  User,
  ShoppingBag,
  Sparkles,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

type Role = "owner" | "inventory" | "sales" | "internal"

const roles: { id: Role; label: string }[] = [
  { id: "owner", label: "Owner" },
  { id: "inventory", label: "Inventory" },
  { id: "sales", label: "Sales" },
  { id: "internal", label: "Internal use" },
]

// ── Owner mockup ─────────────────────────────────────────────────────────────

function StatTile({
  icon,
  value,
  label,
  accent,
}: {
  icon: React.ReactNode
  value: string
  label: string
  accent?: "violet" | "coral"
}) {
  return (
    <div className="bg-alabaster rounded-xl p-3 flex flex-col gap-2">
      <div
        className={cn(
          "w-7 h-7 rounded-lg flex items-center justify-center",
          accent === "violet"
            ? "bg-violet/10 text-violet"
            : accent === "coral"
              ? "bg-coral/10 text-coral"
              : "bg-obsidian/5 text-obsidian/60",
        )}
      >
        {icon}
      </div>
      <div>
        <p className="text-base font-bold text-obsidian leading-none">{value}</p>
        <p className="text-[11px] text-obsidian/50 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

function OwnerMockup() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <StatTile icon={<Package className="size-3.5" />} value="1,247" label="Total stock" />
      <StatTile
        icon={<Clock className="size-3.5" />}
        value="3"
        label="Outstanding"
        accent="coral"
      />
      <StatTile
        icon={<Bell className="size-3.5" />}
        value="12"
        label="Pending requests"
      />
      <StatTile
        icon={<MapPin className="size-3.5" />}
        value="4"
        label="Branches"
        accent="violet"
      />
    </div>
  )
}

// ── Inventory mockup ──────────────────────────────────────────────────────────

const vendors = [
  { name: "MedSupply Co.", balance: "₦45,000", due: "3 days" },
  { name: "PharmaDist Ltd", balance: "₦12,500", due: "5 days" },
  { name: "CosmeticsPro", balance: "₦8,200", due: "7 days" },
]

function InventoryMockup() {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between text-[10px] font-medium text-obsidian/40 uppercase tracking-wide pb-2 border-b border-obsidian/5">
        <span className="flex-1">Vendor</span>
        <span className="w-20 text-right">Balance</span>
        <span className="w-14 text-right">Due</span>
      </div>
      {vendors.map((v) => (
        <div
          key={v.name}
          className="flex items-center justify-between py-2.5 border-b border-obsidian/5 last:border-0"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-6 h-6 rounded-md bg-violet/10 flex items-center justify-center flex-shrink-0">
              <Building2 className="size-3 text-violet" />
            </div>
            <span className="text-xs font-medium text-obsidian truncate">{v.name}</span>
          </div>
          <span className="text-xs font-semibold text-obsidian w-20 text-right">{v.balance}</span>
          <div className="w-14 flex justify-end">
            <span className="text-[10px] bg-coral/10 text-coral rounded-full px-1.5 py-0.5 font-medium">
              {v.due}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Sales mockup ──────────────────────────────────────────────────────────────

const customers = [
  { name: "Amina Yusuf", item: "Hair serum", amount: "₦5,400" },
  { name: "Bisi Adeyemi", item: "Facial cream", amount: "₦2,800" },
  { name: "Chidi Okafor", item: "Wellness kit", amount: "₦7,200" },
]

function SalesMockup() {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between text-[10px] font-medium text-obsidian/40 uppercase tracking-wide pb-2 border-b border-obsidian/5">
        <span className="flex-1">Customer</span>
        <span className="w-24 text-right">Item</span>
        <span className="w-16 text-right">Amount</span>
      </div>
      {customers.map((c) => (
        <div
          key={c.name}
          className="flex items-center justify-between py-2.5 border-b border-obsidian/5 last:border-0"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-6 h-6 rounded-full bg-obsidian/5 flex items-center justify-center flex-shrink-0">
              <User className="size-3 text-obsidian/50" />
            </div>
            <span className="text-xs font-medium text-obsidian truncate">{c.name}</span>
          </div>
          <span className="text-xs text-obsidian/60 w-24 text-right truncate">{c.item}</span>
          <span className="text-xs font-semibold text-obsidian w-16 text-right">{c.amount}</span>
        </div>
      ))}
    </div>
  )
}

// ── Internal use mockup ───────────────────────────────────────────────────────

const clients = [
  { name: "Kemi Ibrahim", service: "Deep facial", date: "Today" },
  { name: "Tolu Balogun", service: "Massage", date: "Today" },
  { name: "Emeka Nwosu", service: "Chemical peel", date: "Yesterday" },
]

function InternalMockup() {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between text-[10px] font-medium text-obsidian/40 uppercase tracking-wide pb-2 border-b border-obsidian/5">
        <span className="flex-1">Client</span>
        <span className="w-28 text-right">Service</span>
        <span className="w-16 text-right">Date</span>
      </div>
      {clients.map((c) => (
        <div
          key={c.name}
          className="flex items-center justify-between py-2.5 border-b border-obsidian/5 last:border-0"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-6 h-6 rounded-full bg-coral/10 flex items-center justify-center flex-shrink-0">
              <Sparkles className="size-3 text-coral" />
            </div>
            <span className="text-xs font-medium text-obsidian truncate">{c.name}</span>
          </div>
          <span className="text-xs text-obsidian/60 w-28 text-right truncate">{c.service}</span>
          <div className="w-16 flex justify-end">
            <span
              className={cn(
                "text-[10px] rounded-full px-1.5 py-0.5 font-medium",
                c.date === "Today"
                  ? "bg-violet/10 text-violet"
                  : "bg-obsidian/5 text-obsidian/50",
              )}
            >
              {c.date}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Role Picker ───────────────────────────────────────────────────────────────

const mockups: Record<Role, React.ReactNode> = {
  owner: <OwnerMockup />,
  inventory: <InventoryMockup />,
  sales: <SalesMockup />,
  internal: <InternalMockup />,
}

const roleDescriptions: Record<Role, string> = {
  owner: "See everything at a glance — stock, orders, and activity across all your branches.",
  inventory: "Track vendor deliveries, outstanding balances, and restock schedules.",
  sales: "Record every sale by product and customer, and monitor daily revenue.",
  internal: "Manage stock consumption for services — facials, treatments, and more.",
}

export default function RolePicker() {
  const [active, setActive] = useState<Role>("owner")
  const shouldReduceMotion = useReducedMotion()

  const contentVariants = shouldReduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
      }

  const contentTransition = { duration: 0.2, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] }

  return (
    <div className="rounded-2xl shadow-xl shadow-violet/10 border border-obsidian/5 bg-white p-6 flex flex-col gap-5">
      {/* Question label */}
      <p className="text-sm font-medium text-obsidian/60">Which role are you?</p>

      {/* Role pills */}
      <div className="flex flex-wrap gap-2">
        {roles.map((role) => (
          <button
            key={role.id}
            onClick={() => setActive(role.id)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer",
              "duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              active === role.id
                ? "bg-obsidian text-white"
                : "bg-obsidian/5 text-obsidian hover:bg-obsidian/10",
            )}
          >
            {role.label}
          </button>
        ))}
      </div>

      {/* Mockup area — fixed min-height so switching roles doesn't shift layout */}
      <div className="min-h-[172px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            {...contentVariants}
            transition={shouldReduceMotion ? undefined : contentTransition}
          >
            {mockups[active]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Role description */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={active + "-desc"}
          {...contentVariants}
          transition={shouldReduceMotion ? undefined : contentTransition}
          className="text-xs text-obsidian/50 leading-relaxed border-t border-obsidian/5 pt-4 flex items-start gap-2"
        >
          <ChevronRight className="size-3 flex-shrink-0 mt-0.5 text-violet" />
          {roleDescriptions[active]}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}
