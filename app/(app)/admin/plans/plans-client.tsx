"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, BookOpen } from "lucide-react"
import { planSchema, type PlanInput } from "@/lib/validation/plans"
import { createPlanAction, updatePlanAction, togglePlanAction } from "@/lib/db/actions/plans"
import type { Plan } from "@/lib/db/queries/plans"
import type { ServiceType } from "@/lib/db/queries/services"
import { formatNaira } from "@/lib/format/money"
import { ServiceTypeSearch } from "@/components/app/services/service-type-search"
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

// ── Plan form dialog ──────────────────────────────────────────────────────────

function PlanFormDialog({
  open,
  onClose,
  onSuccess,
  editing,
  serviceTypes,
  canCreateServiceType,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  editing: Plan | null
  serviceTypes: ServiceType[]
  canCreateServiceType: boolean
}) {
  // Tracks service types created inline during this session before a page refresh
  const [extraTypes, setExtraTypes] = useState<ServiceType[]>([])
  const serverIds = new Set(serviceTypes.map((s) => s.id))
  const availableTypes = [...serviceTypes, ...extraTypes.filter((s) => !serverIds.has(s.id))]

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PlanInput>({
    resolver: zodResolver(planSchema),
    values: editing
      ? {
          name:       editing.name,
          type:       editing.type,
          priceNaira: editing.priceCents / 100,
          lines:      editing.lines.length > 0
            ? editing.lines.map((l) => ({ serviceTypeId: l.serviceTypeId, sessionCount: l.sessionCount }))
            : [{ serviceTypeId: "", sessionCount: 1 }],
        }
      : { name: "", type: "single", priceNaira: 0, lines: [{ serviceTypeId: "", sessionCount: 1 }] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  const watchedType  = watch("type")
  const watchedLines = watch("lines")
  const totalSessions = (watchedLines ?? []).reduce((s, l) => s + (l.sessionCount || 0), 0)

  const isSingle = watchedType === "single"

  function handleClose() {
    reset()
    onClose()
  }

  async function onSubmit(values: PlanInput) {
    const result = editing
      ? await updatePlanAction(editing.id, values)
      : await createPlanAction(values)

    if (!result.ok) {
      toast.error(result.message ?? result.error)
      return
    }

    toast.success(editing ? "Plan updated" : "Plan created")
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit plan" : "New plan"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Plan name</Label>
            <Input id="plan-name" placeholder="e.g. 6-Session Facial Package" className="h-9 text-sm" {...register("name")} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          {/* Type + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-type">Type</Label>
              <select id="plan-type" className={SELECT_CLASS} {...register("type")}>
                <option value="single">Single service</option>
                <option value="package">Package (multiple services)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-price">
                List price (<span className="font-inter">₦</span>)
              </Label>
              <Input
                id="plan-price"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                className="h-9 text-sm tabular-nums"
                {...register("priceNaira", { valueAsNumber: true })}
              />
              {errors.priceNaira && <p className="text-xs text-red-500">{errors.priceNaira.message}</p>}
              <p className="text-xs text-neutral-400">Default; clients may pay a different amount.</p>
            </div>
          </div>

          {/* Service lines */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>
                {isSingle ? "Service" : "Services"}
              </Label>
              {totalSessions > 0 && (
                <span className="text-xs font-mono text-neutral-500 tabular-nums">
                  {totalSessions} session{totalSessions !== 1 ? "s" : ""} total
                </span>
              )}
            </div>

            {fields.map((field, index) => (
              <div key={field.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs">Service type</Label>
                    <ServiceTypeSearch
                      value={watchedLines?.[index]?.serviceTypeId ?? ""}
                      onChange={(id) => setValue(`lines.${index}.serviceTypeId`, id, { shouldValidate: true })}
                      serviceTypes={availableTypes}
                      canCreate={canCreateServiceType}
                      onCreated={(st) => setExtraTypes((prev) => [...prev, st])}
                      error={errors.lines?.[index]?.serviceTypeId?.message}
                    />
                    {errors.lines?.[index]?.serviceTypeId && (
                      <p className="text-xs text-red-500">{errors.lines[index]?.serviceTypeId?.message}</p>
                    )}
                  </div>
                  <div className="w-24 space-y-1.5">
                    <Label className="text-xs">Sessions</Label>
                    <Input
                      type="number"
                      min={1}
                      placeholder="1"
                      className="h-9 text-sm tabular-nums"
                      {...register(`lines.${index}.sessionCount`, { valueAsNumber: true })}
                    />
                    {errors.lines?.[index]?.sessionCount && (
                      <p className="text-xs text-red-500">{errors.lines[index]?.sessionCount?.message}</p>
                    )}
                  </div>
                  {fields.length > 1 && (
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      className="mt-6 text-neutral-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {!isSingle && (
              <button
                type="button"
                onClick={() => append({ serviceTypeId: "", sessionCount: 1 })}
                className="flex items-center gap-1.5 text-sm text-violet-700 hover:text-violet-800 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add another service
              </button>
            )}

            {errors.lines?.root && (
              <p className="text-xs text-red-500">{errors.lines.root.message}</p>
            )}
          </div>
        </form>

        <DialogFooter showCloseButton>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={handleSubmit(onSubmit)}
            className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
          >
            {isSubmitting ? "Saving…" : editing ? "Save changes" : "Create plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

type Props = {
  initialPlans:         Plan[]
  serviceTypes:         ServiceType[]
  canCreateServiceType: boolean
}

export function PlansClient({ initialPlans, serviceTypes, canCreateServiceType }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing]       = useState<Plan | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  function handleSuccess() {
    setDialogOpen(false)
    setEditing(null)
    startTransition(() => router.refresh())
  }

  async function handleToggle(plan: Plan) {
    setTogglingId(plan.id)
    const result = await togglePlanAction(plan.id, !plan.isActive)
    setTogglingId(null)
    if (!result.ok) {
      toast.error(result.message ?? result.error)
      return
    }
    toast.success(plan.isActive ? "Plan deactivated" : "Plan activated")
    startTransition(() => router.refresh())
  }

  const active   = initialPlans.filter((p) => p.isActive)
  const inactive = initialPlans.filter((p) => !p.isActive)

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Plans</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Define single-service and package plans. Clients subscribe to a plan to track sessions and revenue.
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setDialogOpen(true) }}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-violet-700 hover:bg-violet-800 text-white px-4 h-9 text-sm font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New plan
        </button>
      </div>

      {initialPlans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 p-10 text-center">
          <BookOpen className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-400">No plans yet. Create your first plan above.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50">
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Active</p>
              </div>
              <div className="divide-y divide-neutral-100">
                {active.map((plan) => (
                  <div key={plan.id} className="flex items-center justify-between px-5 py-4 gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-neutral-950">{plan.name}</p>
                        <span className="text-xs font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                          {plan.type === "single" ? "single" : "package"}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {plan.totalSessions} session{plan.totalSessions !== 1 ? "s" : ""}
                        {plan.lines.length > 1 && ` across ${plan.lines.length} services`}
                        {" · "}
                        <span className="font-inter">₦</span>{formatNaira(plan.priceCents)} list
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => { setEditing(plan); setDialogOpen(true) }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggle(plan)}
                        disabled={togglingId === plan.id}
                        className="inline-flex items-center rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50"
                      >
                        Deactivate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {inactive.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50">
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Inactive</p>
              </div>
              <div className="divide-y divide-neutral-100">
                {inactive.map((plan) => (
                  <div key={plan.id} className="flex items-center justify-between px-5 py-4 gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-400 line-through">{plan.name}</p>
                      <p className="text-xs text-neutral-300 mt-0.5">
                        {plan.totalSessions} sessions · <span className="font-inter">₦</span>{formatNaira(plan.priceCents)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleToggle(plan)}
                      disabled={togglingId === plan.id}
                      className="shrink-0 inline-flex items-center rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50"
                    >
                      Activate
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <PlanFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null) }}
        onSuccess={handleSuccess}
        editing={editing}
        serviceTypes={serviceTypes}
        canCreateServiceType={canCreateServiceType}
      />
    </div>
  )
}
