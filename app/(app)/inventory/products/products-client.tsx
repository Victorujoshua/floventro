"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { MoreHorizontal, Plus, Package } from "lucide-react"
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
import { ProductForm } from "@/components/app/forms/product-form"
import { deleteProductAction } from "@/lib/db/actions/products"

type Product = {
  id: string
  sku: string
  name: string
  description: string | null
  reorder_point: number
  unit_cost_cents: number | null
  stock: number
  created_at: string
  updated_at: string
}

type Props = {
  products: Product[]
}

export function ProductsClient({ products }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [dialogState, setDialogState] = useState<
    | { type: "create" }
    | { type: "edit"; product: Product }
    | { type: "delete"; product: Product }
    | null
  >(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return products
    return products.filter(
      (p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    )
  }, [products, search])

  const handleSuccess = () => {
    setDialogState(null)
    router.refresh()
  }

  const handleDelete = async () => {
    if (dialogState?.type !== "delete") return
    setIsDeleting(true)
    const result = await deleteProductAction(dialogState.product.id)
    setIsDeleting(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success("Product deleted")
    setDialogState(null)
    router.refresh()
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Products</h1>
        <Button
          onClick={() => setDialogState({ type: "create" })}
          className="bg-violet-700 hover:bg-violet-800 text-white rounded-md"
        >
          <Plus className="h-4 w-4 mr-2" />
          New product
        </Button>
      </div>

      {/* Empty state */}
      {products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Package className="h-10 w-10 text-neutral-300 mb-4" />
          <p className="text-sm font-medium text-neutral-950">No products yet</p>
          <p className="text-sm text-neutral-500 mt-1">
            Add your first product to build your catalogue.
          </p>
          <Button
            onClick={() => setDialogState({ type: "create" })}
            className="mt-4 bg-violet-700 hover:bg-violet-800 text-white rounded-md"
          >
            <Plus className="h-4 w-4 mr-2" />
            New product
          </Button>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="mb-4">
            <Input
              placeholder="Search by SKU or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm rounded-md"
            />
          </div>

          {/* Table */}
          <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-neutral-50">
                  <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    SKU
                  </TableHead>
                  <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Name
                  </TableHead>
                  <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Reorder point
                  </TableHead>
                  <TableHead className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Stock
                  </TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-sm text-neutral-500">
                      No products match your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((product) => (
                    <TableRow key={product.id} className="py-3">
                      <TableCell className="font-mono text-sm tabular-nums text-neutral-700 py-3">
                        {product.sku}
                      </TableCell>
                      <TableCell className="text-sm text-neutral-950 py-3">
                        {product.name}
                      </TableCell>
                      <TableCell className="text-sm font-mono tabular-nums text-neutral-700 py-3">
                        {product.reorder_point}
                      </TableCell>
                      <TableCell className={`text-sm font-mono tabular-nums py-3 ${
                        product.stock === 0
                          ? "text-red-500"
                          : product.reorder_point > 0 && product.stock <= product.reorder_point
                          ? "text-amber-500"
                          : "text-neutral-700"
                      }`}>
                        {product.stock}
                      </TableCell>
                      <TableCell className="py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                setDialogState({ type: "edit", product })
                              }
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600"
                              onClick={() =>
                                setDialogState({ type: "delete", product })
                              }
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
        onOpenChange={(open) => { if (!open) setDialogState(null) }}
      >
        <DialogContent className="rounded-xl max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialogState?.type === "create" ? "New product" : "Edit product"}
            </DialogTitle>
          </DialogHeader>
          {dialogState?.type === "create" && (
            <ProductForm mode="create" onSuccess={handleSuccess} />
          )}
          {dialogState?.type === "edit" && (
            <ProductForm
              mode="edit"
              initialData={{
                id: dialogState.product.id,
                sku: dialogState.product.sku,
                name: dialogState.product.name,
                description: dialogState.product.description ?? "",
                reorderPoint: dialogState.product.reorder_point,
              }}
              onSuccess={handleSuccess}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog
        open={dialogState?.type === "delete"}
        onOpenChange={(open) => { if (!open) setDialogState(null) }}
      >
        <DialogContent className="rounded-xl max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete product?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-500">
            <span className="font-medium text-neutral-950">
              {dialogState?.type === "delete" ? dialogState.product.name : ""}
            </span>{" "}
            will be removed from your catalogue. This cannot be undone.
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
