"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Plus, Pencil, Sparkles } from "lucide-react"
import { serviceTypeSchema, type ServiceTypeInput } from "@/lib/validation/services"
import {
  createServiceTypeAction,
  updateServiceTypeAction,
  toggleServiceTypeAction,
} from "@/lib/db/actions/services"
import type { ServiceType } from "@/lib/db/queries/services"
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

// ── Service form dialog ───────────────────────────────────────────────────────

function ServiceFormDialog({
  open,
  onClose,
  onSuccess,
  editing,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  editing: ServiceType | null
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ServiceTypeInput>({
    resolver: zodResolver(serviceTypeSchema),
    values: editing
      ? {
          name: editing.name,
          description: editing.description ?? "",
          defaultPriceNaira: editing.defaultPriceCents / 100,
          isActive: editing.isActive,
        }
      : { name: "", description: "", defaultPriceNaira: 0, isActive: true },
  })

  function handleClose() {
    reset()
    onClose()
  }

  async function onSubmit(values: ServiceTypeInput) {
    const result = editing
      ? await updateServiceTypeAction(editing.id, values)
      : await createServiceTypeAction(values)

    if (!result.ok) {
      toast.error(result.message ?? result.error)
      return
    }

    toast.success(editing ? "Service updated" : "Service created")
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit service" : "New service"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="svc-name">Name</Label>
            <Input
              id="svc-name"
              placeholder="e.g. Facial, Installation"
              className="h-9 text-sm"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="svc-price">
              Default price (<span className="font-inter">₦</span>)
            </Label>
            <Input
              id="svc-price"
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              className="h-9 text-sm tabular-nums"
              {...register("defaultPriceNaira", { valueAsNumber: true })}
            />
            {errors.defaultPriceNaira && (
              <p className="text-xs text-red-500">{errors.defaultPriceNaira.message}</p>
            )}
            <p className="text-xs text-neutral-400">
              Pre-fills when this service is added to a sale. Editable at the point of sale.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="svc-description">
              Description <span className="text-neutral-400 font-normal">(optional)</span>
            </Label>
            <textarea
              id="svc-description"
              rows={2}
              placeholder="Brief description of the service"
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
              {...register("description")}
            />
            {errors.description && (
              <p className="text-xs text-red-500">{errors.description.message}</p>
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
            {isSubmitting ? "Saving…" : editing ? "Save changes" : "Create service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

type Props = {
  initialServices: ServiceType[]
}

export function ServicesClient({ initialServices }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceType | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  function handleSuccess() {
    setDialogOpen(false)
    setEditing(null)
    startTransition(() => router.refresh())
  }

  async function handleToggle(svc: ServiceType) {
    setTogglingId(svc.id)
    const result = await toggleServiceTypeAction(svc.id, !svc.isActive)
    setTogglingId(null)
    if (!result.ok) {
      toast.error(result.message ?? result.error)
      return
    }
    toast.success(svc.isActive ? "Service deactivated" : "Service activated")
    startTransition(() => router.refresh())
  }

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(svc: ServiceType) {
    setEditing(svc)
    setDialogOpen(true)
  }

  const active = initialServices.filter((s) => s.isActive)
  const inactive = initialServices.filter((s) => !s.isActive)

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Services</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Manage your service catalog. Services appear in the sale modal and the consumption log.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-violet-700 hover:bg-violet-800 text-white px-4 h-9 text-sm font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New service
        </button>
      </div>

      {initialServices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 p-10 text-center">
          <Sparkles className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-400">No services yet. Create your first service above.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-neutral-100 bg-neutral-50">
                <p className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Active</p>
              </div>
              <div className="divide-y divide-neutral-100">
                {active.map((svc) => (
                  <div key={svc.id} className="flex items-center justify-between px-5 py-4 gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-950">{svc.name}</p>
                      {svc.description && (
                        <p className="text-xs text-neutral-400 mt-0.5 truncate max-w-xs">{svc.description}</p>
                      )}
                      <p className="text-xs text-neutral-400 tabular-nums mt-0.5">
                        Default: <span className="font-inter">₦</span>{formatNaira(svc.defaultPriceCents)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openEdit(svc)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggle(svc)}
                        disabled={togglingId === svc.id}
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
                {inactive.map((svc) => (
                  <div key={svc.id} className="flex items-center justify-between px-5 py-4 gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-400 line-through">{svc.name}</p>
                      <p className="text-xs text-neutral-300 tabular-nums mt-0.5">
                        Default: <span className="font-inter">₦</span>{formatNaira(svc.defaultPriceCents)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleToggle(svc)}
                      disabled={togglingId === svc.id}
                      className="inline-flex items-center rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors disabled:opacity-50 shrink-0"
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

      <ServiceFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null) }}
        onSuccess={handleSuccess}
        editing={editing}
      />
    </div>
  )
}
