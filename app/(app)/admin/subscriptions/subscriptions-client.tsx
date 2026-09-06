"use client"

import { useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Plus, CreditCard } from "lucide-react"
import { clientPlanSchema, type ClientPlanInput } from "@/lib/validation/plans"
import { createClientPlanAction } from "@/lib/db/actions/plans"
import type { ClientPlan, PlanSummary } from "@/lib/db/queries/plans"
import type { Client } from "@/lib/db/queries/clients"
import { ClientSearch } from "@/components/app/clients/client-search"
import { formatNaira } from "@/lib/format/money"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 disabled:opacity-50"

function todayLocal() {
  return new Date().toLocaleDateString("en-CA")
}

// ── Subscribe dialog ──────────────────────────────────────────────────────────

function SubscribeDialog({
  open,
  onClose,
  onSuccess,
  activePlans,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  activePlans: PlanSummary[]
}) {
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [clientError, setClientError]       = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClientPlanInput>({
    resolver: zodResolver(clientPlanSchema),
    defaultValues: {
      clientId:       "",
      planId:         "",
      pricePaidNaira: 0,
      purchasedOn:    todayLocal(),
    },
  })

  const watchedPlanId   = watch("planId")
  const selectedPlan    = activePlans.find((p) => p.id === watchedPlanId)

  // When plan changes: default price to plan list price
  useEffect(() => {
    if (selectedPlan) {
      setValue("pricePaidNaira", selectedPlan.priceCents / 100)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedPlanId])

  function handleClose() {
    setSelectedClient(null)
    setClientError(null)
    reset({
      clientId:       "",
      planId:         "",
      pricePaidNaira: 0,
      purchasedOn:    todayLocal(),
    })
    onClose()
  }

  async function onSubmit(values: ClientPlanInput) {
    if (!selectedClient) {
      setClientError("Select a client")
      return
    }
    setClientError(null)

    const result = await createClientPlanAction({ ...values, clientId: selectedClient.id })
    if (!result.ok) {
      toast.error(result.message ?? result.error)
      return
    }

    toast.success("Subscription created")
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Subscribe client to plan</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Client search */}
          <div className="space-y-1.5">
            <Label>Client</Label>
            <ClientSearch
              value={selectedClient}
              onChange={(c) => {
                setSelectedClient(c)
                setClientError(null)
                setValue("clientId", c?.id ?? "")
              }}
              error={clientError ?? undefined}
            />
            {clientError && <p className="text-xs text-red-500">{clientError}</p>}
          </div>

          {/* Plan select */}
          <div className="space-y-1.5">
            <Label htmlFor="sub-plan">Plan</Label>
            {activePlans.length === 0 ? (
              <p className="text-sm text-neutral-400">No active plans. Create a plan first.</p>
            ) : (
              <>
                <select id="sub-plan" className={SELECT_CLASS} {...register("planId")}>
                  <option value="">Select a plan…</option>
                  {activePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.totalSessions} session{p.totalSessions !== 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
                {errors.planId && <p className="text-xs text-red-500">{errors.planId.message}</p>}
              </>
            )}
          </div>

          {/* Sessions preview + price */}
          {selectedPlan && (
            <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 space-y-1.5">
              <div className="flex justify-between text-xs text-neutral-500">
                <span>Total sessions</span>
                <span className="font-mono tabular-nums font-medium text-neutral-950">
                  {selectedPlan.totalSessions}
                </span>
              </div>
              <div className="flex justify-between text-xs text-neutral-500">
                <span>Price</span>
                <span className="font-mono tabular-nums text-neutral-950">
                  <span className="font-inter">₦</span>{formatNaira(selectedPlan.priceCents)}
                </span>
              </div>
            </div>
          )}

          {/* Price paid + date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sub-price">
                Price paid (<span className="font-inter">₦</span>)
              </Label>
              <Input
                id="sub-price"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                className="h-9 text-sm tabular-nums"
                {...register("pricePaidNaira", { valueAsNumber: true })}
              />
              {errors.pricePaidNaira && (
                <p className="text-xs text-red-500">{errors.pricePaidNaira.message}</p>
              )}
              <p className="text-xs text-neutral-400">What the client actually paid.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-date">Purchase date</Label>
              <Input id="sub-date" type="date" className="h-9 text-sm" {...register("purchasedOn")} />
              {errors.purchasedOn && (
                <p className="text-xs text-red-500">{errors.purchasedOn.message}</p>
              )}
            </div>
          </div>
        </form>

        <DialogFooter showCloseButton>
          <Button
            type="button"
            disabled={isSubmitting || activePlans.length === 0}
            onClick={handleSubmit(onSubmit)}
            className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
          >
            {isSubmitting ? "Subscribing…" : "Create subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

type Props = {
  initialClientPlans: ClientPlan[]
  activePlans:        PlanSummary[]
}

export function SubscriptionsClient({ initialClientPlans, activePlans }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)

  function handleSuccess() {
    setDialogOpen(false)
    startTransition(() => router.refresh())
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Subscriptions</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Client plan subscriptions. Sessions draw down when a service is recorded against a subscription.
          </p>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-violet-700 hover:bg-violet-800 text-white px-4 h-9 text-sm font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Subscribe
        </button>
      </div>

      {initialClientPlans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 p-10 text-center">
          <CreditCard className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-400">No subscriptions yet. Subscribe a client to a plan above.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="divide-y divide-neutral-100">
            {initialClientPlans.map((sub) => {
              const isExhausted = sub.sessionsRemaining === 0
              const pct = Math.round((sub.sessionsUsed / sub.sessionsTotal) * 100)
              return (
                <div key={sub.id} className="px-5 py-4 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-neutral-950">{sub.clientName}</p>
                        {sub.clientMemberId && (
                          <span className="text-xs font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                            {sub.clientMemberId}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {sub.planName ?? "Ad-hoc"} · purchased {sub.purchasedOn}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-mono tabular-nums text-neutral-950">
                        <span className="font-inter">₦</span>{formatNaira(sub.pricePaidCents)}
                      </p>
                      <p className="text-xs text-neutral-400 tabular-nums">
                        <span className="font-inter">₦</span>
                        {sub.sessionsTotal > 0
                          ? formatNaira(Math.floor(sub.pricePaidCents / sub.sessionsTotal))
                          : "0"} / session
                      </p>
                    </div>
                  </div>

                  {/* Session progress */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className={`font-medium ${isExhausted ? "text-neutral-400" : "text-neutral-700"}`}>
                        {sub.sessionsUsed} of {sub.sessionsTotal} sessions used
                      </span>
                      <span className={`font-mono tabular-nums ${isExhausted ? "text-neutral-400" : "text-violet-700"}`}>
                        {isExhausted ? "Exhausted" : `${sub.sessionsRemaining} remaining`}
                      </span>
                    </div>
                    <div className="relative h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                      <div
                        className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                          isExhausted ? "bg-neutral-300" : "bg-violet-400"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <SubscribeDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSuccess={handleSuccess}
        activePlans={activePlans}
      />
    </div>
  )
}
