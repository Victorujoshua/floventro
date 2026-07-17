"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Plus, Pencil, Sparkles } from "lucide-react"
import type { ServiceType } from "@/lib/db/queries/services"
import { serviceTypeSchema, type ServiceTypeInput } from "@/lib/validation/services"
import { createServiceTypeAction, updateServiceTypeAction } from "@/lib/db/actions/services"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
  serviceTypes: ServiceType[]
}

export function ServicesClient({ serviceTypes: initial }: Props) {
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceType | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ServiceTypeInput>({
    resolver: zodResolver(serviceTypeSchema),
    defaultValues: { name: "", description: "", isActive: true },
  })

  function openAdd() {
    setEditing(null)
    reset({ name: "", description: "", isActive: true })
    setSubmitError(null)
    setModalOpen(true)
  }

  function openEdit(st: ServiceType) {
    setEditing(st)
    reset({ name: st.name, description: st.description ?? "", isActive: st.isActive })
    setSubmitError(null)
    setModalOpen(true)
  }

  function handleClose() {
    setModalOpen(false)
    setEditing(null)
    setSubmitError(null)
  }

  async function onSubmit(values: ServiceTypeInput) {
    setSubmitError(null)
    const result = editing
      ? await updateServiceTypeAction(editing.id, values)
      : await createServiceTypeAction(values)

    if (!result.ok) {
      if (result.error === "duplicate_name") {
        setSubmitError("A service type with this name already exists.")
      } else {
        setSubmitError(result.message ?? "Something went wrong. Please try again.")
      }
      return
    }

    toast.success(editing ? "Service updated" : "Service added")
    handleClose()
    router.refresh()
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Services</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Define the services your team performs
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add service
        </button>
      </div>

      {initial.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center px-6">
          <Sparkles className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No services yet</p>
          <p className="text-sm text-neutral-500 mt-1 max-w-sm">
            Add the services your team performs (e.g. Facial, Consultation).
          </p>
          <button
            onClick={openAdd}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-9 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add service
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50">
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Name
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Description
                </TableHead>
                <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  Status
                </TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {initial.map((st) => (
                <TableRow key={st.id} className="hover:bg-neutral-50/60 transition-colors">
                  <TableCell className="text-sm font-medium text-neutral-950 py-3.5">
                    {st.name}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-500 py-3.5 max-w-xs truncate">
                    {st.description ?? <span className="text-neutral-300">—</span>}
                  </TableCell>
                  <TableCell className="py-3.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        st.isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {st.isActive ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell className="py-3.5 text-right">
                    <button
                      onClick={() => openEdit(st)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-3 h-7 text-xs font-medium text-neutral-700 hover:bg-neutral-200 transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add / Edit modal */}
      <Dialog open={modalOpen} onOpenChange={(o) => { if (!o) handleClose() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit service" : "Add service"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="e.g. Facial, Consultation" {...register("name")} />
              {errors.name && (
                <p className="text-xs text-red-500">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">
                Description <span className="text-neutral-400 font-normal">(optional)</span>
              </Label>
              <textarea
                id="description"
                rows={2}
                placeholder="Brief description of the service"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 resize-none"
                {...register("description")}
              />
              {errors.description && (
                <p className="text-xs text-red-500">{errors.description.message}</p>
              )}
            </div>

            {editing && (
              <div className="flex items-center gap-2">
                <input
                  id="isActive"
                  type="checkbox"
                  className="h-4 w-4 rounded border-neutral-300 text-violet-700 focus:ring-violet-700"
                  {...register("isActive")}
                />
                <Label htmlFor="isActive" className="text-sm font-normal">
                  Active (visible to team when recording services)
                </Label>
              </div>
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
              disabled={isSubmitting}
              onClick={handleSubmit(onSubmit)}
              className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
            >
              {isSubmitting ? "Saving…" : editing ? "Save changes" : "Add service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
