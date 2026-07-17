"use client"

import { useEffect, useState } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { serviceUsageSchema, type ServiceUsageInput } from "@/lib/validation/services"
import { recordServiceUsageAction, getActiveServiceTypesAction } from "@/lib/db/actions/services"
import { getMyHoldingsAction } from "@/lib/db/actions/holdings"
import type { MyHolding } from "@/lib/db/queries/holdings"
import type { ServiceType } from "@/lib/db/queries/services"
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
  const [holdings, setHoldings] = useState<MyHolding[]>([])
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

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
      serviceTypeId: "",
      customerName: "",
      customerPhone: "",
      performedOn: todayLocal(),
      serviceFeeNaira: undefined,
      note: "",
      lines: [{ productId: initialProductId ?? "", quantity: 1 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  const watchedLines = watch("lines")
  const performedOn = watch("performedOn")

  const isFutureDate = performedOn && performedOn > todayLocal()

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
        console.error("service dialog load failed", err)
        setLoadError("Could not load data: " + ((err as Error)?.message ?? "unknown"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, initialProductId, setValue])

  function handleClose() {
    reset({
      serviceTypeId: "",
      customerName: "",
      customerPhone: "",
      performedOn: todayLocal(),
      serviceFeeNaira: undefined,
      note: "",
      lines: [{ productId: initialProductId ?? "", quantity: 1 }],
    })
    setSubmitError(null)
    setLoadError(null)
    onOpenChange(false)
  }

  const usedProductIds = new Set((watchedLines ?? []).map((l) => l.productId).filter(Boolean))

  function getHoldingForLine(index: number): MyHolding | undefined {
    const pid = watchedLines?.[index]?.productId
    return holdings.find((h) => h.productId === pid)
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
                    setLoadError(null)
                    setLoading(true)
                    Promise.all([getMyHoldingsAction(), getActiveServiceTypesAction()])
                      .then(([h, st]) => { setHoldings(h); setServiceTypes(st) })
                      .catch((err: unknown) => {
                        setLoadError("Could not load data: " + ((err as Error)?.message ?? "unknown"))
                      })
                      .finally(() => setLoading(false))
                  }}
                  className="text-sm text-violet-700 hover:text-violet-800 underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : serviceTypes.length === 0 ? (
              <p className="text-sm text-neutral-500">No active services defined. Ask an owner or inventory manager to add them under Inventory → Services.</p>
            ) : (
              <>
                <select
                  id="serviceTypeId"
                  className={SELECT_CLASS}
                  {...register("serviceTypeId")}
                >
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
                  <div
                    key={field.id}
                    className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-3"
                  >
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
                          You hold{" "}
                          <span className="font-medium tabular-nums">{holding.quantity}</span> units
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-1.5">
                        <Label htmlFor={`qty-${index}`} className="text-xs">
                          Quantity used
                        </Label>
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
                          <p className="text-xs text-red-500">
                            {errors.lines[index]?.quantity?.message}
                          </p>
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
              {!loading && !loadError && holdings.length === 0 && (
                <p className="text-sm text-neutral-500">
                  You have no stock in your holding to use.
                </p>
              )}
            </div>
          )}

          {/* Customer */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="customerName">
                Customer name <span className="text-neutral-400 font-normal">(optional)</span>
              </Label>
              <Input id="customerName" placeholder="Walk-in" {...register("customerName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customerPhone">
                Phone <span className="text-neutral-400 font-normal">(optional)</span>
              </Label>
              <Input id="customerPhone" placeholder="08012345678" {...register("customerPhone")} />
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
