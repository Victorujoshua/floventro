"use client"

import { useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Plus, Pencil, FlaskConical } from "lucide-react"
import { serviceItemSchema, measurementSchema } from "@/lib/validation/service-items"
import type { ServiceItemInput, MeasurementInput } from "@/lib/validation/service-items"
import {
  createServiceItemAction,
  updateServiceItemAction,
  toggleServiceItemAction,
  createMeasurementAction,
} from "@/lib/db/actions/service-items"
import type { Measurement, ServiceItem } from "@/lib/db/queries/service-items"
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
  "flex h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 disabled:opacity-50"

const CATEGORY_LABELS: Record<string, string> = {
  product:   "Product",
  supply:    "Supply",
  equipment: "Others",
}

const CATEGORY_COLORS: Record<string, string> = {
  product:   "bg-violet-50 text-violet-700 border-violet-200",
  supply:    "bg-blue-50 text-blue-700 border-blue-200",
  equipment: "bg-amber-50 text-amber-700 border-amber-200",
}

type ProductOption = { id: string; name: string; sku: string }

// ── Measurement label helper ──────────────────────────────────────────────────

function measurementLabel(m: Measurement) {
  return m.symbol ? `${m.name} (${m.symbol})` : m.name
}

// ── Item cost description ─────────────────────────────────────────────────────

function itemCostLine(item: ServiceItem): string {
  const naira = `₦${formatNaira(item.amountCents)}`
  if (item.category === "equipment") return `${naira}/session (flat fee)`
  if (!item.packageSize || item.measurementName === "flat_rate") return `${naira} flat`

  const sym = item.measurementSymbol ?? item.measurementName ?? "unit"
  const unitCost = item.amountCents / item.packageSize
  return `${item.packageSize} ${sym} — ${naira} (₦${formatNaira(unitCost)}/${sym})`
}

// ── Inline add-measurement mini-form ─────────────────────────────────────────

function AddMeasurementForm({
  onCreated,
  onCancel,
}: {
  onCreated: (m: { id: string; name: string; symbol: string | null }) => void
  onCancel: () => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MeasurementInput>({ resolver: zodResolver(measurementSchema) })

  async function onSubmit(values: MeasurementInput) {
    const result = await createMeasurementAction(values)
    if (!result.ok) {
      toast.error(result.message ?? "Could not create measurement.")
      return
    }
    toast.success(`Measurement "${result.data.name}" added.`)
    onCreated(result.data)
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 space-y-3">
      <p className="text-xs font-medium text-violet-700">New measurement</p>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Input
            placeholder="Name (e.g. drops)"
            className="h-8 text-sm"
            {...register("name")}
          />
          {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
        </div>
        <div className="w-24 space-y-1">
          <Input
            placeholder="Symbol"
            className="h-8 text-sm"
            {...register("symbol")}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleSubmit(onSubmit)}
          className="inline-flex items-center rounded-md bg-violet-700 hover:bg-violet-800 text-white px-3 h-7 text-xs font-medium transition-colors disabled:opacity-50"
        >
          {isSubmitting ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Service item form dialog ──────────────────────────────────────────────────

function ServiceItemFormDialog({
  open,
  onClose,
  onSuccess,
  editing,
  measurements: initialMeasurements,
  flatRateId,
  products,
}: {
  open: boolean
  onClose: () => void
  onSuccess: (newMeasurements: Measurement[]) => void
  editing: ServiceItem | null
  measurements: Measurement[]
  flatRateId: string | null
  products: ProductOption[]
}) {
  const [measurements, setMeasurements] = useState(initialMeasurements)
  const [showAddMeasurement, setShowAddMeasurement] = useState(false)

  // Keep local measurements in sync when dialog re-opens with fresh data.
  useEffect(() => { setMeasurements(initialMeasurements) }, [initialMeasurements, open])

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ServiceItemInput>({
    resolver: zodResolver(serviceItemSchema),
    values: editing
      ? {
          name:          editing.name,
          category:      editing.category,
          measurementId: editing.measurementId ?? "",
          packageSize:   editing.packageSize    ?? undefined,
          amountNaira:   editing.amountCents / 100,
          productId:     editing.productId      ?? "",
          isActive:      editing.isActive,
        }
      : {
          name: "", category: "product", measurementId: "",
          packageSize: undefined, amountNaira: 0, productId: "", isActive: true,
        },
  })

  const category      = watch("category")
  const measurementId = watch("measurementId")
  const isEquipment   = category === "equipment"
  const isFlatRate    = !measurementId || measurementId === flatRateId
  const showPackage   = !isFlatRate
  const showProductLink = category === "product"

  // When category switches to equipment, default measurement to flat_rate.
  useEffect(() => {
    if (isEquipment && flatRateId) {
      setValue("measurementId", flatRateId)
      setValue("packageSize", undefined)
    }
  }, [isEquipment, flatRateId, setValue])

  // When measurement switches to flat_rate, clear package_size.
  useEffect(() => {
    if (isFlatRate) setValue("packageSize", undefined)
  }, [isFlatRate, setValue])

  function handleClose() {
    reset()
    setShowAddMeasurement(false)
    onClose()
  }

  function handleMeasurementCreated(m: { id: string; name: string; symbol: string | null }) {
    const newM: Measurement = {
      id: m.id, name: m.name, symbol: m.symbol,
      organisationId: null, isSystem: false, createdAt: new Date().toISOString(),
    }
    const updated = [...measurements, newM].sort((a, b) => a.name.localeCompare(b.name))
    setMeasurements(updated)
    setValue("measurementId", m.id)
    setShowAddMeasurement(false)
    onSuccess(updated)
  }

  async function onSubmit(values: ServiceItemInput) {
    const result = editing
      ? await updateServiceItemAction(editing.id, values)
      : await createServiceItemAction(values)

    if (!result.ok) {
      toast.error(result.message ?? result.error)
      return
    }

    toast.success(editing ? "Item updated" : "Item created")
    handleClose()
    onSuccess(measurements)
  }

  const systemMeasurements = measurements.filter((m) => m.isSystem)
  const customMeasurements = measurements.filter((m) => !m.isSystem)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit item" : "New service item"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="si-name">Name</Label>
            <Input
              id="si-name"
              placeholder="e.g. Phollicles, Tissue, Treatment Bed"
              className="h-9 text-sm"
              {...register("name")}
            />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label htmlFor="si-category">Category</Label>
            <select id="si-category" className={SELECT_CLASS} {...register("category")}>
              <option value="product">Product — consumable, links to inventory</option>
              <option value="supply">Supply — consumable, no inventory link</option>
              <option value="equipment">Others — reusable, flat per-session fee</option>
            </select>
            {errors.category && <p className="text-xs text-red-500">{errors.category.message}</p>}
          </div>

          {/* Measurement */}
          <div className="space-y-1.5">
            <Label htmlFor="si-measurement">Measurement</Label>
            <select
              id="si-measurement"
              className={SELECT_CLASS}
              disabled={isEquipment}
              {...register("measurementId")}
            >
              <option value="">— select —</option>
              <optgroup label="System">
                {systemMeasurements.map((m) => (
                  <option key={m.id} value={m.id}>{measurementLabel(m)}</option>
                ))}
              </optgroup>
              {customMeasurements.length > 0 && (
                <optgroup label="Custom">
                  {customMeasurements.map((m) => (
                    <option key={m.id} value={m.id}>{measurementLabel(m)}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {errors.measurementId && (
              <p className="text-xs text-red-500">{errors.measurementId.message}</p>
            )}
            {!isEquipment && !showAddMeasurement && (
              <button
                type="button"
                onClick={() => setShowAddMeasurement(true)}
                className="text-xs text-violet-700 hover:text-violet-900 transition-colors"
              >
                + Add measurement
              </button>
            )}
            {showAddMeasurement && (
              <AddMeasurementForm
                onCreated={handleMeasurementCreated}
                onCancel={() => setShowAddMeasurement(false)}
              />
            )}
            {isEquipment && (
              <p className="text-xs text-neutral-400">Others always uses flat rate.</p>
            )}
          </div>

          {/* Package size — only for non-flat measurements */}
          {showPackage && (
            <div className="space-y-1.5">
              <Label htmlFor="si-pkg">Package size</Label>
              <Input
                id="si-pkg"
                type="number"
                min={0}
                step="any"
                placeholder="e.g. 400"
                className="h-9 text-sm tabular-nums"
                {...register("packageSize", {
                  setValueAs: (v: string) => (v === "" || v == null ? null : parseFloat(v)),
                })}
              />
              <p className="text-xs text-neutral-400">
                The quantity in the measurement unit per package (e.g. 400 for a 400 ml bottle).
              </p>
              {errors.packageSize && (
                <p className="text-xs text-red-500">{errors.packageSize.message}</p>
              )}
            </div>
          )}

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="si-amount">
              {isEquipment ? "Flat fee (₦)" : "Package cost (₦)"}
            </Label>
            <Input
              id="si-amount"
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              className="h-9 text-sm tabular-nums"
              {...register("amountNaira", { valueAsNumber: true })}
            />
            <p className="text-xs text-neutral-400">
              {isEquipment
                ? "Charged per session regardless of duration."
                : "Cost of one package. Unit cost is derived automatically."}
            </p>
            {errors.amountNaira && (
              <p className="text-xs text-red-500">{errors.amountNaira.message}</p>
            )}
          </div>

          {/* Product link — product category only */}
          {showProductLink && (
            <div className="space-y-1.5">
              <Label htmlFor="si-product">
                Inventory product link{" "}
                <span className="text-neutral-400 font-normal">(optional)</span>
              </Label>
              <select id="si-product" className={SELECT_CLASS} {...register("productId")}>
                <option value="">— none —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
              <p className="text-xs text-neutral-400">
                Records which inventory product this item corresponds to. No data flow in Phase 1.
              </p>
            </div>
          )}

          {/* Active toggle — edit mode */}
          {editing && (
            <div className="flex items-center gap-2">
              <input
                id="si-active"
                type="checkbox"
                className="rounded border-neutral-300"
                {...register("isActive")}
              />
              <Label htmlFor="si-active" className="cursor-pointer">Active</Label>
            </div>
          )}
        </form>

        <DialogFooter showCloseButton>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={handleSubmit(onSubmit)}
            className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
          >
            {isSubmitting ? "Saving…" : editing ? "Save changes" : "Create item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

type CategoryFilter = "all" | "product" | "supply" | "equipment"

type Props = {
  initialItems:        ServiceItem[]
  initialMeasurements: Measurement[]
  products:            ProductOption[]
}

export function ServiceItemsClient({ initialItems, initialMeasurements, products }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [measurements, setMeasurements] = useState(initialMeasurements)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing,    setEditing]    = useState<ServiceItem | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [filter,     setFilter]     = useState<CategoryFilter>("all")

  const flatRateId = measurements.find((m) => m.name === "flat_rate")?.id ?? null

  function handleSuccess(updatedMeasurements: Measurement[]) {
    setMeasurements(updatedMeasurements)
    setDialogOpen(false)
    setEditing(null)
    startTransition(() => router.refresh())
  }

  async function handleToggle(item: ServiceItem) {
    setTogglingId(item.id)
    const result = await toggleServiceItemAction(item.id, !item.isActive)
    setTogglingId(null)
    if (!result.ok) {
      toast.error(result.message ?? "Could not update item.")
      return
    }
    toast.success(item.isActive ? "Item deactivated" : "Item activated")
    startTransition(() => router.refresh())
  }

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(item: ServiceItem) {
    setEditing(item)
    setDialogOpen(true)
  }

  const filtered = initialItems.filter((i) => filter === "all" || i.category === filter)
  const active   = filtered.filter((i) => i.isActive)
  const inactive = filtered.filter((i) => !i.isActive)

  const FILTERS: { value: CategoryFilter; label: string }[] = [
    { value: "all",       label: "All" },
    { value: "product",   label: "Product" },
    { value: "supply",    label: "Supply" },
    { value: "equipment", label: "Others" },
  ]

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Service Items</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Catalog of products, supplies, and equipment used during services. Cost is derived
            per-measurement unit.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-violet-700 hover:bg-violet-800 text-white px-4 h-9 text-sm font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New item
        </button>
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-md px-3 h-8 text-xs font-medium transition-colors ${
              filter === f.value
                ? "bg-violet-700 text-white"
                : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-2 text-xs text-neutral-400">
          {filtered.length} item{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 p-10 text-center">
          <FlaskConical className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-400">
            {initialItems.length === 0
              ? "No service items yet. Create your first item above."
              : "No items in this category."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <section className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50">
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Active</p>
              </div>
              <div className="divide-y divide-neutral-100">
                {active.map((item) => (
                  <ServiceItemRow
                    key={item.id}
                    item={item}
                    toggling={togglingId === item.id}
                    onEdit={() => openEdit(item)}
                    onToggle={() => handleToggle(item)}
                  />
                ))}
              </div>
            </section>
          )}

          {inactive.length > 0 && (
            <section className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50">
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Inactive</p>
              </div>
              <div className="divide-y divide-neutral-100">
                {inactive.map((item) => (
                  <ServiceItemRow
                    key={item.id}
                    item={item}
                    toggling={togglingId === item.id}
                    onEdit={() => openEdit(item)}
                    onToggle={() => handleToggle(item)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <ServiceItemFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null) }}
        onSuccess={handleSuccess}
        editing={editing}
        measurements={measurements}
        flatRateId={flatRateId}
        products={products}
      />
    </div>
  )
}

// ── Item row ──────────────────────────────────────────────────────────────────

function ServiceItemRow({
  item,
  toggling,
  onEdit,
  onToggle,
}: {
  item: ServiceItem
  toggling: boolean
  onEdit: () => void
  onToggle: () => void
}) {
  return (
    <div className={`flex items-center justify-between px-5 py-4 gap-4 ${!item.isActive ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <p className={`text-sm font-medium text-neutral-950 ${!item.isActive ? "line-through text-neutral-400" : ""}`}>
            {item.name}
          </p>
          <span
            className={`inline-flex items-center rounded border px-2 h-5 text-[11px] font-medium ${
              CATEGORY_COLORS[item.category] ?? "bg-neutral-50 text-neutral-600 border-neutral-200"
            }`}
          >
            {CATEGORY_LABELS[item.category]}
          </span>
        </div>
        <p className="text-xs text-neutral-400 tabular-nums">{itemCostLine(item)}</p>
        {item.productName && (
          <p className="text-xs text-neutral-400 mt-0.5">
            Links to: {item.productName} ({item.productSku})
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
        <button
          onClick={onToggle}
          disabled={toggling}
          className="inline-flex items-center rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50"
        >
          {item.isActive ? "Deactivate" : "Activate"}
        </button>
      </div>
    </div>
  )
}
