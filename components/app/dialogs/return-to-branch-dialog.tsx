"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { returnSchema } from "@/lib/validation/returns"
import type { ReturnInput } from "@/lib/validation/returns"
import { returnToBranchAction } from "@/lib/db/actions/returns"
import type { MyHolding } from "@/lib/db/queries/holdings"
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
  holding: MyHolding | null
}

export function ReturnToBranchDialog({ open, onOpenChange, onSuccess, holding }: Props) {
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ReturnInput>({
    resolver: zodResolver(returnSchema),
    defaultValues: {
      productId: "",
      quantity: 1,
      note: "",
    },
  })

  // Reset form whenever the dialog opens with a (potentially different) holding.
  useEffect(() => {
    if (open && holding) {
      reset({ productId: holding.productId, quantity: 1, note: "" })
      setSubmitError(null)
    }
  }, [open, holding, reset])

  const quantity = watch("quantity")
  const newHolding = holding ? Math.max(0, holding.quantity - (Number(quantity) || 0)) : 0
  const previewValid =
    holding != null && Number(quantity) >= 1 && Number(quantity) <= holding.quantity

  function handleClose() {
    reset({ productId: holding?.productId ?? "", quantity: 1, note: "" })
    setSubmitError(null)
    onOpenChange(false)
  }

  async function onSubmit(values: ReturnInput) {
    setSubmitError(null)
    const result = await returnToBranchAction(values)
    if (!result.ok) {
      setSubmitError(result.message ?? result.error)
      return
    }
    toast.success("Returned to branch")
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return to branch</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 pt-1">
          {/* Product info */}
          {holding && (
            <div className="rounded-lg bg-neutral-50 border border-neutral-100 px-4 py-3 space-y-0.5">
              <p className="text-sm font-medium text-neutral-950">{holding.productName}</p>
              <p className="text-xs font-mono text-neutral-500">{holding.productSku}</p>
              <p className="text-xs text-neutral-500 mt-1.5">
                You currently hold{" "}
                <span className="font-medium tabular-nums text-neutral-950">{holding.quantity}</span>{" "}
                units
              </p>
            </div>
          )}

          {/* Hidden product ID */}
          <input type="hidden" {...register("productId")} />

          {/* Quantity */}
          <div className="space-y-1.5">
            <Label htmlFor="return-quantity">Quantity to return</Label>
            <Input
              id="return-quantity"
              type="number"
              min={1}
              max={holding?.quantity ?? 1}
              className="h-9 text-sm tabular-nums"
              {...register("quantity", { valueAsNumber: true })}
            />
            {errors.quantity && (
              <p className="text-xs text-red-500">{errors.quantity.message}</p>
            )}
          </div>

          {/* Live preview */}
          {previewValid && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 space-y-0.5">
              <p>
                Your holding will drop from{" "}
                <span className="font-medium tabular-nums text-neutral-950">{holding!.quantity}</span>{" "}
                to{" "}
                <span className="font-medium tabular-nums text-neutral-950">{newHolding}</span>.
              </p>
              <p>
                Branch stock will rise by{" "}
                <span className="font-medium tabular-nums text-neutral-950">{Number(quantity)}</span>.
              </p>
            </div>
          )}

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="return-note">
              Why are you returning this?{" "}
              <span className="text-neutral-400 font-normal">(optional)</span>
            </Label>
            <textarea
              id="return-note"
              rows={2}
              placeholder="e.g. leftover after event, leaving branch"
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
            disabled={isSubmitting || !previewValid}
            onClick={handleSubmit(onSubmit)}
            className="bg-neutral-800 hover:bg-neutral-900 text-white rounded-md"
          >
            {isSubmitting ? "Returning…" : "Return to branch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
