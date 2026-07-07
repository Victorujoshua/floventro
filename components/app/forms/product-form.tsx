"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { productSchema, type ProductInput } from "@/lib/validation/products"
import { createProductAction, updateProductAction } from "@/lib/db/actions/products"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

type Props = {
  mode: "create" | "edit"
  initialData?: ProductInput & { id: string }
  onSuccess: () => void
}

export function ProductForm({ mode, initialData, onSuccess }: Props) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: initialData
      ? {
          sku: initialData.sku,
          name: initialData.name,
          description: initialData.description ?? "",
          reorderPoint: initialData.reorderPoint,
        }
      : { reorderPoint: 0 },
  })

  const onSubmit = async (values: ProductInput) => {
    const result =
      mode === "create"
        ? await createProductAction(values)
        : await updateProductAction(initialData!.id, values)

    if (!result.ok) {
      if (result.code === "sku_taken" || result.error === "sku_taken") {
        setError("sku", { message: "A product with this SKU already exists" })
      } else {
        toast.error(result.error)
      }
      return
    }

    toast.success(mode === "create" ? "Product created" : "Product updated")
    onSuccess()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" placeholder="e.g. PROD-001" {...register("sku")} />
          {errors.sku && (
            <p className="text-xs text-red-500">{errors.sku.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reorderPoint">Reorder point</Label>
          <Input
            id="reorderPoint"
            type="number"
            min={0}
            placeholder="0"
            {...register("reorderPoint", { valueAsNumber: true })}
          />
          {errors.reorderPoint && (
            <p className="text-xs text-red-500">{errors.reorderPoint.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="Product name" {...register("name")} />
        {errors.name && (
          <p className="text-xs text-red-500">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="Optional description"
          rows={3}
          {...register("description")}
        />
        {errors.description && (
          <p className="text-xs text-red-500">{errors.description.message}</p>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          disabled={isSubmitting}
          className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
        >
          {isSubmitting ? "Saving…" : "Save product"}
        </Button>
      </div>
    </form>
  )
}
