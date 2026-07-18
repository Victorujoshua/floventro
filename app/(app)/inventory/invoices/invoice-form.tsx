"use client"

import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, X } from "lucide-react"
import { invoiceSchema, type InvoiceInput } from "@/lib/validation/invoices"
import { recordInvoiceAction } from "@/lib/db/actions/invoices"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type Vendor = { id: string; name: string }
type Product = { id: string; sku: string; name: string }
type Branch = { id: string; name: string }

type Props = {
  vendors: Vendor[]
  products: Product[]
  resolvedBranchId: string | null
  branches: Branch[]
}

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 disabled:cursor-not-allowed disabled:opacity-50"

function formatNaira(naira: number) {
  return naira.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function InvoiceForm({ vendors, products, resolvedBranchId, branches }: Props) {
  const router = useRouter()
  const today = new Date().toISOString().split("T")[0]

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InvoiceInput>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      branchId: resolvedBranchId ?? "",
      vendorId: "",
      invoiceNumber: "",
      invoiceDate: today,
      dueDate: "",
      note: "",
      lines: [{ productId: "", quantity: 1, unitCostNaira: 0 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: "lines" })

  const watchedLines = useWatch({ control, name: "lines" })
  const runningTotal = (watchedLines ?? []).reduce((sum, line) => {
    const qty = Number(line.quantity) || 0
    const cost = Number(line.unitCostNaira) || 0
    return sum + qty * cost
  }, 0)

  const onSubmit = async (values: InvoiceInput) => {
    const result = await recordInvoiceAction(values)

    if (!result.ok) {
      const messages: Record<string, string> = {
        not_allowed: "You don't have permission to record invoices for this branch.",
        bad_vendor: "The selected vendor doesn't belong to this branch.",
        bad_product: "One or more products don't belong to this organisation.",
        branch_required: "Please select a branch.",
        server: "Something went wrong. Please try again.",
      }
      toast.error(messages[result.code ?? "server"] ?? result.error)
      return
    }

    toast.success("Invoice recorded. Receive stock when it arrives.")
    router.push("/inventory/products")
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Record invoice</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Stock moves when you confirm delivery.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Hidden resolved branch, or selector for multi-branch owner */}
        {resolvedBranchId ? (
          <input type="hidden" {...register("branchId")} value={resolvedBranchId} />
        ) : branches.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor="branchId">Branch</Label>
            <select id="branchId" {...register("branchId")} className={SELECT_CLASS}>
              <option value="">Select a branch…</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {errors.branchId && (
              <p className="text-xs text-red-500">{errors.branchId.message}</p>
            )}
          </div>
        ) : null}

        {/* Vendor */}
        <div className="space-y-1.5">
          <Label htmlFor="vendorId">
            Vendor <span className="text-red-500">*</span>
          </Label>
          <select id="vendorId" {...register("vendorId")} className={SELECT_CLASS}>
            <option value="">Select a vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          {errors.vendorId && (
            <p className="text-xs text-red-500">{errors.vendorId.message}</p>
          )}
        </div>

        {/* Invoice number / dates */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="invoiceNumber">Invoice number</Label>
            <Input id="invoiceNumber" placeholder="e.g. INV-0042" {...register("invoiceNumber")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invoiceDate">
              Invoice date <span className="text-red-500">*</span>
            </Label>
            <Input id="invoiceDate" type="date" {...register("invoiceDate")} />
            {errors.invoiceDate && (
              <p className="text-xs text-red-500">{errors.invoiceDate.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dueDate">Due date</Label>
            <Input id="dueDate" type="date" {...register("dueDate")} />
          </div>
        </div>

        {/* Note */}
        <div className="space-y-1.5">
          <Label htmlFor="note">Note</Label>
          <Textarea id="note" placeholder="Optional note" rows={2} {...register("note")} />
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-neutral-950">Line items</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ productId: "", quantity: 1, unitCostNaira: 0 })}
              className="rounded-md text-sm"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add line
            </Button>
          </div>

          {errors.lines?.root && (
            <p className="mb-2 text-xs text-red-500">{errors.lines.root.message}</p>
          )}
          {typeof errors.lines?.message === "string" && (
            <p className="mb-2 text-xs text-red-500">{errors.lines.message}</p>
          )}

          <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_100px_120px_36px] gap-3 px-4 py-2 bg-neutral-50 border-b border-neutral-200">
              <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Product</span>
              <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Qty</span>
              <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                Unit cost (<span className="font-inter">₦</span>)
              </span>
              <span />
            </div>

            {/* Rows */}
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="grid grid-cols-[1fr_100px_120px_36px] gap-3 items-start px-4 py-3 border-b border-neutral-100 last:border-0"
              >
                <div>
                  <select
                    {...register(`lines.${index}.productId`)}
                    className={SELECT_CLASS}
                  >
                    <option value="">Select product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                  {errors.lines?.[index]?.productId && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.lines[index].productId?.message}
                    </p>
                  )}
                </div>

                <div>
                  <Input
                    type="number"
                    min={1}
                    {...register(`lines.${index}.quantity`, { valueAsNumber: true })}
                    className="rounded-md"
                  />
                  {errors.lines?.[index]?.quantity && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.lines[index].quantity?.message}
                    </p>
                  )}
                </div>

                <div>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-500 font-inter">
                      ₦
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      {...register(`lines.${index}.unitCostNaira`, { valueAsNumber: true })}
                      className="rounded-md pl-7"
                    />
                  </div>
                  {errors.lines?.[index]?.unitCostNaira && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.lines[index].unitCostNaira?.message}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={fields.length === 1}
                  className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:pointer-events-none disabled:opacity-30 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Running total + submit */}
        <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
          <div className="text-sm text-neutral-700">
            Total{" "}
            <span className="text-lg font-semibold text-neutral-950 font-mono tabular-nums">
              <span className="font-inter">₦</span>
              {formatNaira(runningTotal)}
            </span>
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
          >
            {isSubmitting ? "Recording…" : "Record invoice"}
          </Button>
        </div>
      </form>
    </div>
  )
}
