"use client"

import { useEffect, useState } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { saleSchema, type SaleInput } from "@/lib/validation/sales"
import { recordSaleAction } from "@/lib/db/actions/sales"
import { getMyHoldingsAction, type MyHolding } from "@/lib/db/actions/holdings"
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

function todayLocal() {
  return new Date().toLocaleDateString("en-CA")
}

export function RecordSaleDialog({ open, onOpenChange, onSuccess, initialProductId }: Props) {
  const [holdings, setHoldings] = useState<MyHolding[]>([])
  const [loadingHoldings, setLoadingHoldings] = useState(false)
  const [holdingsError, setHoldingsError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SaleInput>({
    resolver: zodResolver(saleSchema),
    defaultValues: {
      customerName: "",
      customerPhone: "",
      soldOn: todayLocal(),
      note: "",
      lines: [{ productId: initialProductId ?? "", quantity: 1, unitPriceNaira: 0 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  const watchedLines = watch("lines")
  const soldOn = watch("soldOn")

  const isFutureDate = soldOn && soldOn > todayLocal()

  const grandTotalNaira = (watchedLines ?? []).reduce((sum, line) => {
    return sum + (line.quantity || 0) * (line.unitPriceNaira || 0)
  }, 0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingHoldings(true)
    setHoldingsError(null)
    getMyHoldingsAction()
      .then((h) => {
        if (cancelled) return
        setHoldings(h)
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
      .finally(() => {
        if (!cancelled) setLoadingHoldings(false)
      })
    return () => { cancelled = true }
  }, [open, initialProductId, setValue])

  function handleClose() {
    reset({
      customerName: "",
      customerPhone: "",
      soldOn: todayLocal(),
      note: "",
      lines: [{ productId: initialProductId ?? "", quantity: 1, unitPriceNaira: 0 }],
    })
    setSubmitError(null)
    setHoldingsError(null)
    onOpenChange(false)
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
          {/* Lines */}
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
                    getMyHoldingsAction()
                      .then((h) => { setHoldings(h) })
                      .catch((err: unknown) => {
                        console.error("holdings retry failed", err)
                        setHoldingsError("Could not load your holding: " + ((err as Error)?.message ?? "unknown"))
                      })
                      .finally(() => setLoadingHoldings(false))
                  }}
                  className="text-sm text-violet-700 hover:text-violet-800 underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : holdings.length === 0 ? (
              <p className="text-sm text-neutral-500">You have no stock in your holding to sell.</p>
            ) : (
              fields.map((field, index) => {
                const holding = getHoldingForLine(index)
                const currentProductId = watchedLines?.[index]?.productId ?? ""
                const availableOptions = holdings.filter(
                  (h) => !usedProductIds.has(h.productId) || h.productId === currentProductId
                )

                return (
                  <div key={field.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-3">
                    {/* Product select */}
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
                    </div>

                    {/* Quantity + Price */}
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

                    {/* Line total + remove */}
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

            {holdings.length > 0 && usedProductIds.size < holdings.length && (
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

          {/* Grand total */}
          <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-700">Total</p>
            <p className="text-base font-semibold tabular-nums text-neutral-950">
              <span className="font-inter">₦</span>
              {formatNaira(Math.round(grandTotalNaira * 100))}
            </p>
          </div>

          {/* Customer */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="customerName">Customer name <span className="text-neutral-400 font-normal">(optional)</span></Label>
              <Input id="customerName" placeholder="Walk-in" {...register("customerName")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customerPhone">Phone <span className="text-neutral-400 font-normal">(optional)</span></Label>
              <Input id="customerPhone" placeholder="08012345678" {...register("customerPhone")} />
            </div>
          </div>

          {/* Date */}
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

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="note">Note <span className="text-neutral-400 font-normal">(optional)</span></Label>
            <textarea
              id="note"
              rows={2}
              placeholder="e.g. payment via transfer"
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
            disabled={isSubmitting || loadingHoldings || !!holdingsError || holdings.length === 0}
            onClick={handleSubmit(onSubmit)}
            className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
          >
            {isSubmitting ? "Recording…" : "Record sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
