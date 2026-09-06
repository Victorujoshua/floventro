"use client"

import { useEffect, useState } from "react"
import { useForm, useFieldArray, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Plus, Trash2, UserRound } from "lucide-react"
import { saleSchema, type SaleInput } from "@/lib/validation/sales"
import { recordSaleAction } from "@/lib/db/actions/sales"
import { getMyHoldingsAction } from "@/lib/db/actions/holdings"
import { getActiveServiceTypesAction } from "@/lib/db/actions/services"
import { getActivePlanSummariesAction } from "@/lib/db/actions/plans"
import { createClientAction } from "@/lib/db/actions/clients"
import { ClientSearch } from "@/components/app/clients/client-search"
import type { MyHolding } from "@/lib/db/queries/holdings"
import type { ServiceType } from "@/lib/db/queries/services"
import type { PlanSummary } from "@/lib/db/queries/plans"
import type { Client } from "@/lib/db/queries/clients"
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

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  initialProductId?: string
}

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 disabled:cursor-not-allowed disabled:opacity-50"

const PAYMENT_METHODS = [
  { value: "cash",          label: "Cash" },
  { value: "pos",           label: "POS" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque",        label: "Cheque" },
  { value: "other",         label: "Other" },
]

function todayLocal() {
  return new Date().toLocaleDateString("en-CA")
}

export function RecordSaleDialog({ open, onOpenChange, onSuccess, initialProductId }: Props) {
  const [holdings, setHoldings]           = useState<MyHolding[]>([])
  const [catalogServices, setCatalogServices] = useState<ServiceType[]>([])
  const [catalogPlans, setCatalogPlans]   = useState<PlanSummary[]>([])
  const [loadingHoldings, setLoadingHoldings] = useState(false)
  const [holdingsError, setHoldingsError] = useState<string | null>(null)
  const [submitError, setSubmitError]     = useState<string | null>(null)
  const [hasValidationErrors, setHasValidationErrors] = useState(false)

  // ── Client state ───────────────────────────────────────────────────────────
  const [selectedClient, setSelectedClient]       = useState<Client | null>(null)
  const [showQuickCreate, setShowQuickCreate]     = useState(false)
  const [newClientName, setNewClientName]         = useState("")
  const [newClientPhone, setNewClientPhone]       = useState("")
  const [newClientMemberId, setNewClientMemberId] = useState("")
  const [newClientError, setNewClientError]       = useState<string | null>(null)
  const [newClientSaving, setNewClientSaving]     = useState(false)

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SaleInput>({
    resolver: zodResolver(saleSchema) as Resolver<SaleInput>,
    defaultValues: {
      clientId: "",
      customerName: "",
      customerPhone: "",
      soldOn: todayLocal(),
      note: "",
      paymentMethod: undefined,
      paymentStatus: "paid",
      vatRate: 7.5,
      lines: [{ productId: initialProductId ?? "", quantity: 1, unitPriceNaira: 0 }],
      serviceLines: [],
      planLines: [],
    },
  })

  const { fields, append, remove }                             = useFieldArray({ control, name: "lines" })
  const { fields: svcFields, append: appendSvc, remove: removeSvc } = useFieldArray({ control, name: "serviceLines" })
  const { fields: planFields, append: appendPlan, remove: removePlan } = useFieldArray({ control, name: "planLines" })

  const watchedLines     = watch("lines")
  const watchedSvcLines  = watch("serviceLines")
  const watchedPlanLines = watch("planLines")
  const soldOn           = watch("soldOn")
  const paymentStatus    = watch("paymentStatus")
  const watchedVatRate   = watch("vatRate") ?? 7.5

  const isFutureDate = soldOn && soldOn > todayLocal()
  const hasPlanLines = (watchedPlanLines ?? []).length > 0

  const productSubtotalCents = (watchedLines ?? []).reduce((sum, line) =>
    sum + Math.round((line.quantity || 0) * (line.unitPriceNaira || 0) * 100), 0)
  const serviceSubtotalCents = (watchedSvcLines ?? []).reduce((sum, line) =>
    sum + Math.round((line.quantity || 0) * (line.unitPriceNaira || 0) * 100), 0)
  const planSubtotalCents = (watchedPlanLines ?? []).reduce((sum, line) =>
    sum + Math.round((line.pricePaidNaira || 0) * 100), 0)
  const subtotalCents      = productSubtotalCents + serviceSubtotalCents + planSubtotalCents
  const vatCentsComputed   = Math.round(subtotalCents * watchedVatRate / 100)
  const totalCentsComputed = subtotalCents + vatCentsComputed

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingHoldings(true)
    setHoldingsError(null)
    Promise.all([getMyHoldingsAction(), getActiveServiceTypesAction(), getActivePlanSummariesAction()])
      .then(([h, cs, plans]) => {
        if (cancelled) return
        setHoldings(h)
        setCatalogServices(cs)
        setCatalogPlans(plans)
        if (initialProductId) {
          const holding = h.find((x) => x.productId === initialProductId)
          if (holding) {
            setValue("lines.0.productId", holding.productId)
            setValue("lines.0.unitPriceNaira", holding.defaultPriceCents != null ? holding.defaultPriceCents / 100 : 0)
          }
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error("holdings load failed", err)
        setHoldingsError("Could not load your holding: " + ((err as Error)?.message ?? "unknown"))
      })
      .finally(() => { if (!cancelled) setLoadingHoldings(false) })
    return () => { cancelled = true }
  }, [open, initialProductId, setValue])

  useEffect(() => {
    setValue("clientId", selectedClient ? selectedClient.id : "")
  }, [selectedClient, setValue])

  function resetClientState() {
    setSelectedClient(null)
    setShowQuickCreate(false)
    setNewClientName(""); setNewClientPhone(""); setNewClientMemberId("")
    setNewClientError(null); setNewClientSaving(false)
  }

  function handleClose() {
    reset({
      clientId: "",
      customerName: "",
      customerPhone: "",
      soldOn: todayLocal(),
      note: "",
      paymentMethod: undefined,
      paymentStatus: "paid",
      vatRate: 7.5,
      lines: [{ productId: initialProductId ?? "", quantity: 1, unitPriceNaira: 0 }],
      serviceLines: [],
      planLines: [],
    })
    setSubmitError(null)
    setHoldingsError(null)
    setHasValidationErrors(false)
    resetClientState()
    onOpenChange(false)
  }

  async function handleQuickCreate() {
    if (!newClientName.trim()) { setNewClientError("Name is required"); return }
    setNewClientSaving(true)
    setNewClientError(null)
    const result = await createClientAction({
      name:     newClientName.trim(),
      phone:    newClientPhone.trim()    || undefined,
      memberId: newClientMemberId.trim() || undefined,
    })
    setNewClientSaving(false)
    if (!result.ok) { setNewClientError(result.message ?? "Error creating client"); return }

    const newClient: Client = {
      id:             result.data.id,
      organisationId: "",
      name:           newClientName.trim(),
      phone:          newClientPhone.trim() || null,
      email:          null,
      memberId:       newClientMemberId.trim() || null,
      createdAt:      new Date().toISOString(),
    }
    setSelectedClient(newClient)
    setShowQuickCreate(false)
    setNewClientName(""); setNewClientPhone(""); setNewClientMemberId("")
  }

  const usedProductIds = new Set((watchedLines ?? []).map((l) => l.productId).filter(Boolean))

  function handleProductChange(index: number, productId: string) {
    setValue(`lines.${index}.productId`, productId)
    const holding = holdings.find((h) => h.productId === productId)
    if (holding) {
      setValue(`lines.${index}.unitPriceNaira`, holding.defaultPriceCents != null ? holding.defaultPriceCents / 100 : 0)
    }
  }

  function getHoldingForLine(index: number): MyHolding | undefined {
    const pid = watchedLines?.[index]?.productId
    return holdings.find((h) => h.productId === pid)
  }

  function handleServiceChange(index: number, serviceTypeId: string) {
    setValue(`serviceLines.${index}.serviceTypeId`, serviceTypeId)
    const svc = catalogServices.find((s) => s.id === serviceTypeId)
    if (svc) {
      setValue(`serviceLines.${index}.serviceName`, svc.name)
      setValue(`serviceLines.${index}.unitPriceNaira`, svc.defaultPriceCents / 100)
    }
  }

  function handlePlanChange(index: number, planId: string) {
    setValue(`planLines.${index}.planId`, planId)
    const plan = catalogPlans.find((p) => p.id === planId)
    if (plan) {
      setValue(`planLines.${index}.pricePaidNaira`, plan.priceCents / 100)
    }
  }

  async function onSubmit(values: SaleInput) {
    setSubmitError(null)
    const result = await recordSaleAction(values)
    if (!result.ok) {
      setSubmitError(result.message ?? result.error)
      return
    }
    toast.success("Sale recorded")
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record sale</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-1">

          {/* Hidden clientId field — synced via useEffect above */}
          <input type="hidden" {...register("clientId")} />

          {/* ── Products ── */}
          <div className="space-y-3">
            <Label>Products sold</Label>
            {loadingHoldings ? (
              <p className="text-sm text-neutral-500">Loading your holding…</p>
            ) : holdingsError ? (
              <div className="space-y-2">
                <p className="text-sm text-red-600">{holdingsError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setHoldingsError(null)
                    setLoadingHoldings(true)
                    Promise.all([getMyHoldingsAction(), getActiveServiceTypesAction(), getActivePlanSummariesAction()])
                      .then(([h, cs, plans]) => { setHoldings(h); setCatalogServices(cs); setCatalogPlans(plans) })
                      .catch((err: unknown) => {
                        setHoldingsError("Could not load: " + ((err as Error)?.message ?? "unknown"))
                      })
                      .finally(() => setLoadingHoldings(false))
                  }}
                  className="text-sm text-violet-700 hover:text-violet-800 underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : holdings.length === 0 ? (
              <p className="text-sm text-neutral-500">You have no stock in your holding.</p>
            ) : (
              fields.map((field, index) => {
                const holding = getHoldingForLine(index)
                const currentProductId = watchedLines?.[index]?.productId ?? ""
                const availableOptions = holdings.filter(
                  (h) => !usedProductIds.has(h.productId) || h.productId === currentProductId
                )
                return (
                  <div key={field.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`lines.${index}.productId`} className="text-xs">Product</Label>
                      <select
                        className={SELECT_CLASS}
                        value={currentProductId}
                        onChange={(e) => handleProductChange(index, e.target.value)}
                      >
                        <option value="">Select a product…</option>
                        {availableOptions.map((h) => (
                          <option key={h.productId} value={h.productId}>
                            {h.productName} ({h.productSku}) — {h.quantity} held
                          </option>
                        ))}
                      </select>
                      {holding && (
                        <p className="text-xs text-neutral-500">
                          You hold <span className="font-medium tabular-nums">{holding.quantity}</span> units
                        </p>
                      )}
                      {errors.lines?.[index]?.productId && (
                        <p className="text-xs text-red-500">Select a product</p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`qty-${index}`} className="text-xs">Quantity</Label>
                        <Input
                          id={`qty-${index}`}
                          type="number"
                          min={1}
                          max={holding?.quantity}
                          placeholder="1"
                          className="h-9 text-sm tabular-nums"
                          {...register(`lines.${index}.quantity`, { valueAsNumber: true })}
                        />
                        {errors.lines?.[index]?.quantity && (
                          <p className="text-xs text-red-500">{errors.lines[index]?.quantity?.message}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`price-${index}`} className="text-xs">
                          Unit price (<span className="font-inter">₦</span>)
                        </Label>
                        <Input
                          id={`price-${index}`}
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="0.00"
                          className="h-9 text-sm tabular-nums"
                          {...register(`lines.${index}.unitPriceNaira`, { valueAsNumber: true })}
                        />
                        {errors.lines?.[index]?.unitPriceNaira && (
                          <p className="text-xs text-red-500">{errors.lines[index]?.unitPriceNaira?.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-xs text-neutral-500">
                        Line total:{" "}
                        <span className="font-medium tabular-nums text-neutral-950">
                          <span className="font-inter">₦</span>
                          {formatNaira(Math.round((watchedLines?.[index]?.quantity || 0) * (watchedLines?.[index]?.unitPriceNaira || 0) * 100))}
                        </span>
                      </p>
                      {fields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          className="text-neutral-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}

            {!loadingHoldings && !holdingsError && holdings.length > 0 && usedProductIds.size < holdings.length && (
              <button
                type="button"
                onClick={() => append({ productId: "", quantity: 1, unitPriceNaira: 0 })}
                className="flex items-center gap-1.5 text-sm text-violet-700 hover:text-violet-800 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add product
              </button>
            )}
          </div>

          {/* ── Services ── */}
          {!loadingHoldings && !holdingsError && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Services</Label>
                <span className="text-xs text-neutral-400">Optional</span>
              </div>

              {catalogServices.length === 0 && svcFields.length === 0 ? (
                <p className="text-xs text-neutral-400">
                  No services in your catalog yet — add them in Admin → Services.
                </p>
              ) : (
                <>
                  {svcFields.map((field, index) => {
                    const currentServiceTypeId = watchedSvcLines?.[index]?.serviceTypeId ?? ""
                    return (
                      <div key={field.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Service</Label>
                          <select
                            className={SELECT_CLASS}
                            value={currentServiceTypeId}
                            onChange={(e) => handleServiceChange(index, e.target.value)}
                          >
                            <option value="">Select a service…</option>
                            {catalogServices.map((svc) => (
                              <option key={svc.id} value={svc.id}>{svc.name}</option>
                            ))}
                          </select>
                          <input type="hidden" {...register(`serviceLines.${index}.serviceTypeId`)} />
                          <input type="hidden" {...register(`serviceLines.${index}.serviceName`)} />
                          {errors.serviceLines?.[index]?.serviceTypeId && (
                            <p className="text-xs text-red-500">{errors.serviceLines[index]?.serviceTypeId?.message}</p>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor={`svc-qty-${index}`} className="text-xs">Quantity</Label>
                            <Input
                              id={`svc-qty-${index}`}
                              type="number"
                              min={1}
                              placeholder="1"
                              className="h-9 text-sm tabular-nums"
                              {...register(`serviceLines.${index}.quantity`, { valueAsNumber: true })}
                            />
                            {errors.serviceLines?.[index]?.quantity && (
                              <p className="text-xs text-red-500">{errors.serviceLines[index]?.quantity?.message}</p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`svc-price-${index}`} className="text-xs">
                              Price (<span className="font-inter">₦</span>)
                            </Label>
                            <Input
                              id={`svc-price-${index}`}
                              type="number"
                              min={0}
                              step="0.01"
                              placeholder="0.00"
                              className="h-9 text-sm tabular-nums"
                              {...register(`serviceLines.${index}.unitPriceNaira`, { valueAsNumber: true })}
                            />
                            {errors.serviceLines?.[index]?.unitPriceNaira && (
                              <p className="text-xs text-red-500">{errors.serviceLines[index]?.unitPriceNaira?.message}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <p className="text-xs text-neutral-500">
                            Line total:{" "}
                            <span className="font-medium tabular-nums text-neutral-950">
                              <span className="font-inter">₦</span>
                              {formatNaira(Math.round((watchedSvcLines?.[index]?.quantity || 0) * (watchedSvcLines?.[index]?.unitPriceNaira || 0) * 100))}
                            </span>
                          </p>
                          <button
                            type="button"
                            onClick={() => removeSvc(index)}
                            className="text-neutral-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}

                  {catalogServices.length > 0 && (
                    <button
                      type="button"
                      onClick={() => appendSvc({ serviceTypeId: "", serviceName: "", quantity: 1, unitPriceNaira: 0 })}
                      className="flex items-center gap-1.5 text-sm text-violet-700 hover:text-violet-800 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add service
                    </button>
                  )}
                </>
              )}

              {errors.lines?.root && (
                <p className="text-xs text-red-500">{errors.lines.root.message}</p>
              )}
            </div>
          )}

          {/* ── Plans ── */}
          {!loadingHoldings && !holdingsError && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Plans</Label>
                <span className="text-xs text-neutral-400">Optional — requires a client</span>
              </div>

              {catalogPlans.length === 0 && planFields.length === 0 ? (
                <p className="text-xs text-neutral-400">
                  No active plans — create them in Admin → Plans.
                </p>
              ) : (
                <>
                  {planFields.map((field, index) => {
                    const currentPlanId = watchedPlanLines?.[index]?.planId ?? ""
                    const selectedPlan  = catalogPlans.find((p) => p.id === currentPlanId)
                    return (
                      <div key={field.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Plan</Label>
                          <select
                            className={SELECT_CLASS}
                            value={currentPlanId}
                            onChange={(e) => handlePlanChange(index, e.target.value)}
                          >
                            <option value="">Select a plan…</option>
                            {catalogPlans.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} — {p.totalSessions} session{p.totalSessions !== 1 ? "s" : ""}
                              </option>
                            ))}
                          </select>
                          {/* hidden field so RHF tracks planId */}
                          <input type="hidden" {...register(`planLines.${index}.planId`)} />
                          {selectedPlan && (
                            <p className="text-xs text-neutral-500">
                              {selectedPlan.totalSessions} session{selectedPlan.totalSessions !== 1 ? "s" : ""}
                            </p>
                          )}
                          {errors.planLines?.[index]?.planId && (
                            <p className="text-xs text-red-500">{errors.planLines[index]?.planId?.message}</p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <Label htmlFor={`plan-price-${index}`} className="text-xs">
                            Price paid (<span className="font-inter">₦</span>)
                          </Label>
                          <Input
                            id={`plan-price-${index}`}
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="0.00"
                            className="h-9 text-sm tabular-nums"
                            {...register(`planLines.${index}.pricePaidNaira`, { valueAsNumber: true })}
                          />
                          {errors.planLines?.[index]?.pricePaidNaira && (
                            <p className="text-xs text-red-500">{errors.planLines[index]?.pricePaidNaira?.message}</p>
                          )}
                        </div>

                        <div className="flex items-center justify-between">
                          <p className="text-xs text-neutral-500">
                            Subscription total:{" "}
                            <span className="font-medium tabular-nums text-neutral-950">
                              <span className="font-inter">₦</span>
                              {formatNaira(Math.round((watchedPlanLines?.[index]?.pricePaidNaira || 0) * 100))}
                            </span>
                          </p>
                          <button
                            type="button"
                            onClick={() => removePlan(index)}
                            className="text-neutral-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}

                  {catalogPlans.length > 0 && (
                    <button
                      type="button"
                      onClick={() => appendPlan({ planId: "", pricePaidNaira: 0 })}
                      className="flex items-center gap-1.5 text-sm text-violet-700 hover:text-violet-800 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add plan
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Subtotal / VAT / Total ── */}
          <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 space-y-2">
            {(serviceSubtotalCents > 0 || planSubtotalCents > 0) && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-500">Products</span>
                  <span className="tabular-nums text-neutral-700">
                    <span className="font-inter">₦</span>
                    {formatNaira(productSubtotalCents)}
                  </span>
                </div>
                {serviceSubtotalCents > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-neutral-500">Services</span>
                    <span className="tabular-nums text-neutral-700">
                      <span className="font-inter">₦</span>
                      {formatNaira(serviceSubtotalCents)}
                    </span>
                  </div>
                )}
                {planSubtotalCents > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-neutral-500">Plans</span>
                    <span className="tabular-nums text-neutral-700">
                      <span className="font-inter">₦</span>
                      {formatNaira(planSubtotalCents)}
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-neutral-500">Subtotal</span>
              <span className="tabular-nums text-neutral-700">
                <span className="font-inter">₦</span>
                {formatNaira(subtotalCents)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-1.5">
                <span className="text-neutral-500">VAT</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  className="w-14 h-7 rounded-md border border-neutral-300 bg-white px-2 text-sm text-neutral-950 tabular-nums text-center focus:outline-none focus:ring-1 focus:ring-violet-700 focus:border-violet-700"
                  {...register("vatRate", { valueAsNumber: true })}
                />
                <span className="text-neutral-500 text-xs">%</span>
              </div>
              <span className="tabular-nums text-neutral-500">
                <span className="font-inter">₦</span>
                {formatNaira(vatCentsComputed)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t border-neutral-200">
              <p className="text-sm font-medium text-neutral-700">Total</p>
              <p className="text-base font-semibold tabular-nums text-neutral-950">
                <span className="font-inter">₦</span>
                {formatNaira(totalCentsComputed)}
              </p>
            </div>
          </div>

          {/* ── Customer / Client ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-neutral-700">Customer</Label>
              <span className="text-xs text-neutral-400">
                {hasPlanLines ? "Required for plan sale" : "Optional — link to a client record"}
              </span>
            </div>

            {showQuickCreate ? (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-3">
                <p className="text-xs font-medium text-neutral-500">New client</p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Name <span className="text-red-500">*</span></Label>
                  <Input
                    placeholder="Jane Doe"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Phone</Label>
                    <Input
                      placeholder="08012345678"
                      value={newClientPhone}
                      onChange={(e) => setNewClientPhone(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Member ID</Label>
                    <Input
                      placeholder="MEM-0001"
                      value={newClientMemberId}
                      onChange={(e) => setNewClientMemberId(e.target.value)}
                      className="h-9 text-sm font-mono"
                    />
                  </div>
                </div>
                {newClientError && <p className="text-xs text-red-500">{newClientError}</p>}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={newClientSaving}
                    onClick={handleQuickCreate}
                    className="inline-flex items-center gap-1.5 rounded-md bg-violet-700 hover:bg-violet-800 text-white px-3 h-8 text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {newClientSaving ? "Creating…" : "Create & select"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowQuickCreate(false); setNewClientError(null) }}
                    className="inline-flex items-center rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="flex-1">
                  <ClientSearch
                    value={selectedClient}
                    onChange={(c) => setSelectedClient(c)}
                    placeholder="Search clients by name or member ID…"
                  />
                </div>
                {!selectedClient && (
                  <button
                    type="button"
                    onClick={() => setShowQuickCreate(true)}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2.5 h-9 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
                  >
                    <UserRound className="h-3 w-3" />
                    New
                  </button>
                )}
              </div>
            )}

            {/* Client required error — fires when plan lines present and no client selected */}
            {errors.clientId && (
              <p className="text-xs text-red-500">{errors.clientId.message}</p>
            )}

            {/* Client linked — show card; or walk-in free-text */}
            {selectedClient ? (
              <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 space-y-0.5">
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1.5">Sale for</p>
                <p className="text-sm font-medium text-neutral-950">{selectedClient.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  {selectedClient.phone && (
                    <span className="text-xs font-mono text-neutral-500">{selectedClient.phone}</span>
                  )}
                  {selectedClient.memberId && (
                    <span className="text-xs font-mono text-neutral-400">#{selectedClient.memberId}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="customerName" className="text-xs">
                    Name <span className="text-neutral-400 font-normal">(optional)</span>
                  </Label>
                  <Input id="customerName" placeholder="Walk-in" {...register("customerName")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="customerPhone" className="text-xs">
                    Phone <span className="text-neutral-400 font-normal">(optional)</span>
                  </Label>
                  <Input id="customerPhone" placeholder="08012345678" {...register("customerPhone")} />
                </div>
              </div>
            )}
          </div>

          {/* ── Payment toggle ── */}
          <div className="space-y-1.5">
            <Label>Payment</Label>
            <div className="grid grid-cols-2 rounded-md border border-neutral-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setValue("paymentStatus", "paid")}
                className={`h-9 text-sm font-medium transition-colors ${
                  paymentStatus === "paid"
                    ? "bg-violet-700 text-white"
                    : "bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                Paid now
              </button>
              <button
                type="button"
                onClick={() => setValue("paymentStatus", "unpaid")}
                className={`h-9 text-sm font-medium border-l border-neutral-300 transition-colors ${
                  paymentStatus === "unpaid"
                    ? "bg-violet-700 text-white"
                    : "bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                On account
              </button>
            </div>
          </div>

          {/* ── Date + Payment method ── */}
          <div className={`grid gap-3 ${paymentStatus === "paid" ? "grid-cols-2" : "grid-cols-1"}`}>
            <div className="space-y-1.5">
              <Label htmlFor="soldOn">Sale date</Label>
              <Input id="soldOn" type="date" {...register("soldOn")} />
              {isFutureDate && (
                <p className="text-xs text-amber-600">This date is in the future.</p>
              )}
              {errors.soldOn && (
                <p className="text-xs text-red-500">{errors.soldOn.message}</p>
              )}
            </div>
            {paymentStatus === "paid" && (
              <div className="space-y-1.5">
                <Label htmlFor="paymentMethod">Payment method</Label>
                <select id="paymentMethod" className={SELECT_CLASS} {...register("paymentMethod")}>
                  <option value="">Select…</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                {errors.paymentMethod && (
                  <p className="text-xs text-red-500">{errors.paymentMethod.message}</p>
                )}
              </div>
            )}
          </div>

          {/* ── Note ── */}
          <div className="space-y-1.5">
            <Label htmlFor="note">Note <span className="text-neutral-400 font-normal">(optional)</span></Label>
            <textarea
              id="note"
              rows={2}
              placeholder="e.g. discount applied"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
              {...register("note")}
            />
          </div>

          {/* ── Validation + submit errors ── */}
          {hasValidationErrors && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              Some fields need attention — check the form above.
            </p>
          )}
          {submitError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {submitError}
            </p>
          )}
        </form>

        <DialogFooter showCloseButton>
          <Button
            type="submit"
            form=""
            disabled={isSubmitting || loadingHoldings || !!holdingsError}
            onClick={handleSubmit(onSubmit, () => setHasValidationErrors(true))}
            className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
          >
            {isSubmitting ? "Recording…" : "Record sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
