"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { MoreHorizontal, Plus, Store } from "lucide-react"
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
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { VendorForm } from "@/components/app/forms/vendor-form"
import { deleteVendorAction } from "@/lib/db/actions/vendors"
import { formatNaira } from "@/lib/format/money"

type Branch = {
  id: string
  name: string
}

type Vendor = {
  id: string
  branch_id: string
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  tin: string | null
  cac_registration: string | null
  notes: string | null
  outstanding_cents: number
  created_at: string
  updated_at: string
}

type Props = {
  vendors: Vendor[]
  branches: Branch[]
}

export function VendorsClient({ vendors, branches }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [dialogState, setDialogState] = useState<
    | { type: "create" }
    | { type: "edit"; vendor: Vendor }
    | { type: "delete"; vendor: Vendor }
    | null
  >(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const showBranchColumn = branches.length > 1

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return vendors
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.contact_person ?? "").toLowerCase().includes(q),
    )
  }, [vendors, search])

  const handleSuccess = () => {
    setDialogState(null)
    router.refresh()
  }

  const handleDelete = async () => {
    if (dialogState?.type !== "delete") return
    setIsDeleting(true)
    const result = await deleteVendorAction(dialogState.vendor.id)
    setIsDeleting(false)
    if (!result.ok) {
      toast.error(result.error === "not_allowed" ? "You don't have permission to delete this vendor." : result.error)
      return
    }
    toast.success("Vendor deleted")
    setDialogState(null)
    router.refresh()
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Vendors</h1>
          <p className="text-sm text-neutral-500 mt-1">Suppliers you buy from</p>
        </div>
        <button
          onClick={() => setDialogState({ type: "create" })}
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New vendor
        </button>
      </div>

      {/* Empty state */}
      {vendors.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-16 text-center">
          <Store className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No vendors yet</p>
          <p className="text-sm text-neutral-500 mt-1">
            Add your first vendor to start recording purchases.
          </p>
          <button
            onClick={() => setDialogState({ type: "create" })}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New vendor
          </button>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="mb-4">
            <Input
              placeholder="Search by name or contact person…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm rounded-lg"
            />
          </div>

          {/* Table */}
          <div className="rounded-2xl border border-neutral-200/60 bg-white overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-neutral-50">
                  <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Name
                  </TableHead>
                  <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Contact person
                  </TableHead>
                  <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Phone
                  </TableHead>
                  <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    TIN
                  </TableHead>
                  <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Outstanding
                  </TableHead>
                  {showBranchColumn && (
                    <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                      Branch
                    </TableHead>
                  )}
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={showBranchColumn ? 7 : 6}
                      className="py-12 text-center text-sm text-neutral-500"
                    >
                      No vendors match your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((vendor) => (
                    <TableRow key={vendor.id} className="hover:bg-neutral-50/60 transition-colors">
                      <TableCell className="text-sm font-medium text-neutral-950 py-3.5">
                        {vendor.name}
                      </TableCell>
                      <TableCell className="text-sm text-neutral-700 py-3.5">
                        {vendor.contact_person ?? <span className="text-neutral-400">—</span>}
                      </TableCell>
                      <TableCell className="text-sm font-mono tabular-nums text-neutral-700 py-3.5">
                        {vendor.phone ?? <span className="text-neutral-400 font-sans">—</span>}
                      </TableCell>
                      <TableCell className="text-sm font-mono tabular-nums text-neutral-700 py-3.5">
                        {vendor.tin ?? <span className="text-neutral-400 font-sans">—</span>}
                      </TableCell>
                      <TableCell className="text-sm font-mono tabular-nums py-3.5 text-neutral-700">
                        <span className="font-inter">₦</span>{formatNaira(vendor.outstanding_cents)}
                      </TableCell>
                      {showBranchColumn && (
                        <TableCell className="text-sm text-neutral-700 py-3.5">
                          {branches.find((b) => b.id === vendor.branch_id)?.name ?? "—"}
                        </TableCell>
                      )}
                      <TableCell className="py-3.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => setDialogState({ type: "edit", vendor })}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() => setDialogState({ type: "delete", vendor })}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Create / Edit dialog */}
      <Dialog
        open={dialogState?.type === "create" || dialogState?.type === "edit"}
        onOpenChange={(open) => {
          if (!open) setDialogState(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogState?.type === "create" ? "New vendor" : "Edit vendor"}
            </DialogTitle>
          </DialogHeader>
          {dialogState?.type === "create" && (
            <VendorForm mode="create" branches={branches} onSuccess={handleSuccess} />
          )}
          {dialogState?.type === "edit" && (
            <VendorForm
              mode="edit"
              branches={branches}
              initialData={{
                id: dialogState.vendor.id,
                branchId: dialogState.vendor.branch_id,
                name: dialogState.vendor.name,
                contactPerson: dialogState.vendor.contact_person ?? "",
                phone: dialogState.vendor.phone ?? "",
                email: dialogState.vendor.email ?? "",
                tin: dialogState.vendor.tin ?? "",
                cacRegistration: dialogState.vendor.cac_registration ?? "",
                notes: dialogState.vendor.notes ?? "",
              }}
              onSuccess={handleSuccess}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog
        open={dialogState?.type === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialogState(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete vendor?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-500">
            <span className="font-medium text-neutral-950">
              {dialogState?.type === "delete" ? dialogState.vendor.name : ""}
            </span>{" "}
            will be removed from your vendor list. This cannot be undone.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setDialogState(null)}
              className="rounded-md"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white rounded-md"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
