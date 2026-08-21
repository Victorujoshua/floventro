"use client"

import { useEffect, useState } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Plus, Trash2, UserRound } from "lucide-react"
import { serviceUsageSchema, type ServiceUsageInput } from "@/lib/validation/services"
import { recordServiceUsageAction, getActiveServiceTypesAction } from "@/lib/db/actions/services"
import { getMyHoldingsAction } from "@/lib/db/actions/holdings"
import { getClientActivePlansAction } from "@/lib/db/actions/plans"
import { createClientAction } from "@/lib/db/actions/clients"
import { ClientSearch } from "@/components/app/clients/client-search"
import type { MyHolding } from "@/lib/db/queries/holdings"
import type { ServiceType } from "@/lib/db/queries/services"
import type { ClientActivePlan } from "@/lib/db/queries/plans"
import type { Client } from "@/lib/db/queries/clients"
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

function todayLocal() {
  return new Date().toLocaleDateString("en-CA")
}

export function RecordServiceDialog({ open, onOpenChange, onSuccess, initialProductId }: Props) {
  const [holdings, setHoldings]           = useState<MyHolding[]>([])
  const [serviceTypes, setServiceTypes]   = useState<ServiceType[]>([])
  const [loadError, setLoadError]         = useState<string | null>(null)
  const [loading, setLoading]             = useState(false)
  const [submitError, setSubmitError]     = useState<string | null>(null)

  // ── Client + plan state ────────────────────────────────────────────────────
  const [selectedClient, setSelectedClient]     = useState<Client | null>(null)
  const [clientPlans, setClientPlans]           = useState<ClientActivePlan[]>([])
  const [loadingPlans, setLoadingPlans]         = useState(false)
  const [showQuickCreate, setShowQuickCreate]   = useState(false)
  const [newClientName, setNewClientName]       = useState("")
  const [newClientPhone, setNewClientPhone]     = useState("")
  const [newClientMemberId, setNewClientMemberId] = useState("")
  const [newClientError, setNewClientError]     = useState<string | null>(null)
  const [newClientSaving, setNewClientSaving]   = useState(false)

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ServiceUsageInput>({
    resolver: zodResolver(serviceUsageSchema),
    defaultValues: {
      serviceTypeId:   "",
      customerName:    "",
      customerPhone:   "",
      memberId:        "",
      clientEmail:     "",
      performedOn:     todayLocal(),
      serviceFeeNaira: undefined,
      note:            "",
      lines:           [{ productId: initialProductId ?? "", quantity: 1 }],
      clientId:        "",
      clientPlanId:    "",
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  const watchedLines   = watch("lines")
  const watchedPlanId  = watch("clientPlanId")
  const performedOn    = watch("performedOn")
  const isFutureDate   = performedOn && performedOn > todayLocal()

  // Load holdings + service types when dialog opens
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    Promise.all([getMyHoldingsAction(), getActiveServiceTypesAction()])
      .then(([h, st]) => {
        if (cancelled) return
        setHoldings(h)
        setServiceTypes(st)
        if (initialProductId) {
          const holding = h.find((x) => x.productId === initialProductId)
          if (holding) setValue("lines.0.productId", holding.productId)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError("Could not load data: " + ((err as Error)?.message ?? "unknown"))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, initialProductId, setValue])

  // Load active plans when a client is selected
  useEffect(() => {
    if (!selectedClient) {
      setClientPlans([])
      setValue("clientId", "")
      setValue("clientPlanId", "")
      return
    }
    setValue("clientId", selectedClient.id)
    setValue("clientPlanId", "")
    // Auto-fill customer name and member ID from selected client
    setValue("customerName", selectedClient.name)
    if (selectedClient.memberId) setValue("memberId", selectedClient.memberId)

    let cancelled = false
    setLoadingPlans(true)
    getClientActivePlansAction(selectedClient.id)
      .then((plans) => { if (!cancelled) setClientPlans(plans) })
      .catch(() => { if (!cancelled) setClientPlans([]) })
      .finally(() => { if (!cancelled) setLoadingPlans(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient?.id])

  function resetClientState() {
    setSelectedClient(null)
    setClientPlans([])
    setLoadingPlans(false)
    setShowQuickCreate(false)
    setNewClientName(""); setNewClientPhone(""); setNewClientMemberId("")
    setNewClientError(null); setNewClientSaving(false)
  }

  function handleClose() {
    reset({
      serviceTypeId:   "",
      customerName:    "",
      customerPhone:   "",
      memberId:        "",
      clientEmail:     "",
      performedOn:     todayLocal(),
      serviceFeeNaira: undefined,
      note:            "",
      lines:           [{ productId: initialProductId ?? "", quantity: 1 }],
      clientId:        "",
      clientPlanId:    "",
    })
    setSubmitError(null)
    setLoadError(null)
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

  function getHoldingForLine(index: number): MyHolding | undefined {
    return holdings.find((h) => h.productId === watchedLines?.[index]?.productId)
  }

  async function onSubmit(values: ServiceUsageInput) {
    setSubmitError(null)
    const result = await recordServiceUsageAction(values)
    if (!result.ok) {
      setSubmitError(result.message ?? result.error)
      return
    }
    toast.success("Service recorded")
    handleClose()
    onSuccess()
  }

  const cannotSubmit = loading || !!loadError || holdings.length === 0 || serviceTypes.length === 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record service</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-1">
          {/* Service type */}
          <div className="space-y-1.5">
            <Label htmlFor="serviceTypeId">Service</Label>
            {loading ? (
              <p className="text-sm text-neutral-500">Loading…</p>
            ) : loadError ? (
              <div className="space-y-2">
                <p className="text-sm text-red-600">{loadError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setLoadError(null); setLoading(true)
                    Promise.all([getMyHoldingsAction(), getActiveServiceTypesAction()])
                      .then(([h, st]) => { setHoldings(h); setServiceTypes(st) })
                      .catch((err: unknown) => setLoadError("Could not load data: " + ((err as Error)?.message ?? "unknown")))
                      .finally(() => setLoading(false))
                  }}
                  className="text-sm text-violet-700 hover:text-violet-800 underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : serviceTypes.length === 0 ? (
              <p className="text-sm text-neutral-500">No active services defined. Ask an owner or inventory manager to add them.</p>
            ) : (
              <>
                <select id="serviceTypeId" className={SELECT_CLASS} {...register("serviceTypeId")}>
                  <option value="">Select a service…</option>
                  {serviceTypes.map((st) => (
                    <option key={st.id} value={st.id}>{st.name}</option>
                  ))}
                </select>
                {errors.serviceTypeId && (
                  <p className="text-xs text-red-500">{errors.serviceTypeId.message}</p>
                )}
              </>
            )}
          </div>

          {/* Products used */}
          {!loading && !loadError && holdings.length > 0 && (
            <div className="space-y-3">
              <Label>Products used</Label>
              {fields.map((field, index) => {
                const holding = getHoldingForLine(index)
                const currentProductId = watchedLines?.[index]?.productId ?? ""
                const availableOptions = holdings.filter(
                  (h) => !usedProductIds.has(h.productId) || h.productId === currentProductId,
                )
                return (
                  <div key={field.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Product</Label>
                      <select
                        className={SELECT_CLASS}
                        value={currentProductId}
                        onChange={(e) => setValue(`lines.${index}.productId`, e.target.value)}
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
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor={`qty-${index}`} className="text-xs">Quantity used</Label>
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
                      {fields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          className="mt-5 text-neutral-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {usedProductIds.size < holdings.length && (
                <button
                  type="button"
                  onClick={() => append({ productId: "", quantity: 1 })}
                  className="flex items-center gap-1.5 text-sm text-violet-700 hover:text-violet-800 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add product
                </button>
              )}
              {errors.lines?.root && (
                <p className="text-xs text-red-500">{errors.lines.root.message}</p>
              )}
            </div>
          )}

          {/* ── Client (optional) ───────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-neutral-700">Client</Label>
              <span className="text-xs text-neutral-400">Optional — links to a plan subscription</span>
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

            {/* ── Plan select (shown when client is selected) ──────────────── */}
            {selectedClient && !showQuickCreate && (
              <div className="space-y-1.5">
                <Label className="text-xs text-neutral-600">Plan subscription</Label>
                {loadingPlans ? (
                  <p className="text-xs text-neutral-400">Loading plans…</p>
                ) : clientPlans.length === 0 ? (
                  <p className="text-xs text-neutral-400">
                    No active subscriptions for this client. Recording as an unlinked session.
                  </p>
                ) : (
                  <>
                    <select
                      className={SELECT_CLASS}
                      {...register("clientPlanId")}
                    >
                      <option value="">No plan — unlinked session</option>
                      {clientPlans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.planName ?? "Ad-hoc"} — {p.sessionsRemaining} of {p.sessionsTotal} remaining
                        </option>
                      ))}
                    </select>
                    {watchedPlanId && (
                      <p className="text-xs text-violet-700">
                        Session will draw down this subscription and snapshot the revenue.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Client details */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="customerName">
                  Client name <span className="text-red-500">*</span>
                </Label>
                <Input id="customerName" placeholder="Jane Doe" {...register("customerName")} />
                {errors.customerName && (
                  <p className="text-xs text-red-500">{errors.customerName.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customerPhone">
                  Phone <span className="text-red-500">*</span>
                </Label>
                <Input id="customerPhone" placeholder="08012345678" {...register("customerPhone")} />
                {errors.customerPhone && (
                  <p className="text-xs text-red-500">{errors.customerPhone.message}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="memberId">
                  Member ID <span className="text-neutral-400 font-normal">(optional)</span>
                </Label>
                <Input id="memberId" placeholder="MEM-0001" {...register("memberId")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clientEmail">
                  Email <span className="text-neutral-400 font-normal">(optional)</span>
                </Label>
                <Input id="clientEmail" type="email" placeholder="jane@example.com" {...register("clientEmail")} />
                {errors.clientEmail && (
                  <p className="text-xs text-red-500">{errors.clientEmail.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Date + Service fee */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="performedOn">Date performed</Label>
              <Input id="performedOn" type="date" {...register("performedOn")} />
              {isFutureDate && (
                <p className="text-xs text-amber-600">This date is in the future.</p>
              )}
              {errors.performedOn && (
                <p className="text-xs text-red-500">{errors.performedOn.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="serviceFeeNaira">
                Service fee (<span className="font-inter">₦</span>){" "}
                <span className="text-neutral-400 font-normal">(optional)</span>
              </Label>
              <Input
                id="serviceFeeNaira"
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                className="h-9 text-sm tabular-nums"
                {...register("serviceFeeNaira", { valueAsNumber: true })}
              />
              <p className="text-xs text-neutral-400">What the client paid for the service</p>
            </div>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="note">
              Note <span className="text-neutral-400 font-normal">(optional)</span>
            </Label>
            <textarea
              id="note"
              rows={2}
              placeholder="e.g. treatment notes"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
              {...register("note")}
            />
          </div>

          {/* Submit error */}
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
            disabled={isSubmitting || cannotSubmit}
            onClick={handleSubmit(onSubmit)}
            className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
          >
            {isSubmitting ? "Recording…" : "Record service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
