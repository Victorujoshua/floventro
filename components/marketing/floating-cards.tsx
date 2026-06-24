"use client"

import { motion, useReducedMotion } from "framer-motion"
import { Package, Inbox, DollarSign, Store, BadgeCheck } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Individual card atoms ─────────────────────────────────────────────────────

function Card({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "bg-white rounded-2xl border border-obsidian/5 shadow-lg shadow-obsidian/5 p-4",
        className,
      )}
    >
      {children}
    </div>
  )
}

function IconBadge({
  icon: Icon,
  color = "violet",
}: {
  icon: React.ElementType
  color?: "violet" | "coral" | "neutral"
}) {
  return (
    <div
      className={cn(
        "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
        color === "violet" && "bg-violet/10 text-violet",
        color === "coral" && "bg-coral/10 text-coral",
        color === "neutral" && "bg-obsidian/5 text-obsidian/60",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </div>
  )
}

// ── Card content components ───────────────────────────────────────────────────

function TotalStockCard() {
  return (
    <Card className="w-[200px]">
      <div className="flex items-center gap-2 mb-3">
        <IconBadge icon={Package} color="violet" />
        <span className="text-xs font-medium text-obsidian/50">Total stock</span>
      </div>
      <p className="text-3xl font-bold text-obsidian font-display">3,782</p>
      <p className="text-xs text-emerald-500 font-medium mt-1 flex items-center gap-1">
        <TrendingUpIcon />
        +12 today
      </p>
    </Card>
  )
}

function TrendingUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1 9L5 5L7.5 7.5L11 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8 3H11V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function PendingRequestsCard() {
  return (
    <Card className="w-[148px]">
      <div className="flex items-center gap-2 mb-3">
        <IconBadge icon={Inbox} color="neutral" />
        <span className="text-xs font-medium text-obsidian/50">Pending</span>
      </div>
      <p className="text-3xl font-bold text-obsidian font-display">5</p>
      <p className="text-xs text-obsidian/40 mt-1">requests</p>
    </Card>
  )
}

function OutstandingBalanceCard() {
  return (
    <Card className="w-[220px]">
      <div className="flex items-center gap-2 mb-3">
        <IconBadge icon={DollarSign} color="coral" />
        <span className="text-xs font-medium text-obsidian/50">Outstanding balance</span>
      </div>
      <p className="text-3xl font-bold text-obsidian font-display">₦1.24m</p>
      <p className="text-xs text-obsidian/40 mt-1">Across 4 vendors</p>
    </Card>
  )
}

function BranchesCard() {
  return (
    <Card className="w-[188px]">
      <div className="flex items-center gap-2 mb-3">
        <IconBadge icon={Store} color="violet" />
        <span className="text-xs font-medium text-obsidian/50">Branches</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["HQ", "Lagos", "Abuja"].map((branch) => (
          <span
            key={branch}
            className="text-[11px] font-medium bg-violet/8 text-violet rounded-full px-2.5 py-1"
          >
            {branch}
          </span>
        ))}
      </div>
    </Card>
  )
}

function ApprovedChip() {
  return (
    <div className="inline-flex items-center gap-2 bg-white border border-obsidian/5 rounded-full px-3 py-2 shadow-md shadow-obsidian/5">
      <BadgeCheck className="size-3.5 text-violet flex-shrink-0" aria-hidden="true" />
      <span className="text-xs font-medium text-obsidian">
        Approved · Vitamin C serum × 15
      </span>
    </div>
  )
}

// ── Animated wrapper ──────────────────────────────────────────────────────────

const CARDS = [
  { id: "total-stock", component: <TotalStockCard />, className: "absolute top-0 left-0" },
  { id: "pending", component: <PendingRequestsCard />, className: "absolute top-5 right-0" },
  { id: "outstanding", component: <OutstandingBalanceCard />, className: "absolute top-[200px] left-6" },
  { id: "branches", component: <BranchesCard />, className: "absolute bottom-[76px] right-0" },
  { id: "approved", component: <ApprovedChip />, className: "absolute bottom-0 left-2" },
]

export default function FloatingCards() {
  const shouldReduceMotion = useReducedMotion()

  return (
    <div className="relative h-[420px] md:h-[480px]" aria-hidden="true">
      {CARDS.map((card, i) => (
        <motion.div
          key={card.id}
          className={card.className}
          initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={
            shouldReduceMotion
              ? undefined
              : {
                  duration: 0.2,
                  delay: i * 0.06,
                  ease: [0.23, 1, 0.32, 1],
                }
          }
        >
          {card.component}
        </motion.div>
      ))}
    </div>
  )
}
