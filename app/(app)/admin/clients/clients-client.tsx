"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { Plus, Pencil, Users } from "lucide-react"
import { clientSchema, type ClientInput } from "@/lib/validation/clients"
import { createClientAction, updateClientAction } from "@/lib/db/actions/clients"
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

// ── Client form dialog ────────────────────────────────────────────────────────

function ClientFormDialog({
  open,
  onClose,
  onSuccess,
  editing,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  editing: Client | null
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClientInput>({
    resolver: zodResolver(clientSchema),
    values: editing
      ? {
          name:     editing.name,
          phone:    editing.phone    ?? "",
          email:    editing.email    ?? "",
          memberId: editing.memberId ?? "",
        }
      : { name: "", phone: "", email: "", memberId: "" },
  })

  function handleClose() {
    reset()
    onClose()
  }

  async function onSubmit(values: ClientInput) {
    const result = editing
      ? await updateClientAction(editing.id, values)
      : await createClientAction(values)

    if (!result.ok) {
      toast.error(result.message ?? result.error)
      return
    }

    toast.success(editing ? "Client updated" : "Client added")
    handleClose()
    onSuccess()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit client" : "Add client"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="client-name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input id="client-name" placeholder="Jane Doe" className="h-9 text-sm" {...register("name")} />
            {errors.name && <p className="text-xs text-red-500">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="client-phone">
                Phone <span className="text-neutral-400 font-normal">(optional)</span>
              </Label>
              <Input id="client-phone" placeholder="08012345678" className="h-9 text-sm" {...register("phone")} />
              {errors.phone && <p className="text-xs text-red-500">{errors.phone.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-member-id">
                Member ID <span className="text-neutral-400 font-normal">(optional)</span>
              </Label>
              <Input id="client-member-id" placeholder="MEM-001" className="h-9 text-sm font-mono" {...register("memberId")} />
              {errors.memberId && <p className="text-xs text-red-500">{errors.memberId.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client-email">
              Email <span className="text-neutral-400 font-normal">(optional)</span>
            </Label>
            <Input id="client-email" type="email" placeholder="jane@example.com" className="h-9 text-sm" {...register("email")} />
            {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
          </div>
        </form>

        <DialogFooter showCloseButton>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={handleSubmit(onSubmit)}
            className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
          >
            {isSubmitting ? "Saving…" : editing ? "Save changes" : "Add client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main client ───────────────────────────────────────────────────────────────

type Props = { initialClients: Client[] }

export function ClientsClient({ initialClients }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing]       = useState<Client | null>(null)

  function handleSuccess() {
    setDialogOpen(false)
    setEditing(null)
    startTransition(() => router.refresh())
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Clients</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Client records used to track plan subscriptions and service history.
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setDialogOpen(true) }}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-violet-700 hover:bg-violet-800 text-white px-4 h-9 text-sm font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add client
        </button>
      </div>

      {initialClients.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 p-10 text-center">
          <Users className="h-8 w-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-400">No clients yet. Add your first client above.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="divide-y divide-neutral-100">
            {initialClients.map((client) => (
              <div key={client.id} className="flex items-center justify-between px-5 py-4 gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-neutral-950">{client.name}</p>
                    {client.memberId && (
                      <span className="text-xs font-mono text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                        {client.memberId}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {client.phone && (
                      <p className="text-xs text-neutral-400 font-mono">{client.phone}</p>
                    )}
                    {client.email && (
                      <p className="text-xs text-neutral-400">{client.email}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setEditing(client); setDialogOpen(true) }}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 h-8 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <ClientFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null) }}
        onSuccess={handleSuccess}
        editing={editing}
      />
    </div>
  )
}
