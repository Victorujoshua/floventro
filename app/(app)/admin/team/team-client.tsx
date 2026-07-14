"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { UserPlus, Copy, Check, Users, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { inviteSchema, type InviteInput } from "@/lib/validation/invites"
import { inviteMemberAction, revokeInviteAction } from "@/lib/db/actions/team"
import type { Member, PendingInvite } from "@/lib/db/queries/team"

type Branch = { id: string; name: string }

type Props = {
  orgName: string
  members: Member[]
  invites: PendingInvite[]
  branches: Branch[]
}

const SELECT_CLASS =
  "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-violet-600/30 focus:border-violet-600 disabled:opacity-50"

const ROLE_OPTIONS = [
  { value: "inventory", label: "Inventory" },
  { value: "sales", label: "Sales" },
  { value: "internal_use", label: "Internal Use" },
]

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  inventory: "Inventory",
  sales: "Sales",
  internal_use: "Internal Use",
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    owner: "bg-tint-violet text-violet-700",
    inventory: "bg-blue-50 text-blue-700",
    sales: "bg-tint-success text-green-700",
    internal_use: "bg-tint-amber text-amber-700",
  }
  const cls = styles[role] ?? "bg-neutral-100 text-neutral-600"
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

type SuccessData = { acceptUrl: string; emailSent: boolean; email: string }

export function TeamClient({ orgName, members, invites, branches }: Props) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [successData, setSuccessData] = useState<SuccessData | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)

  const defaultBranchId = branches.length === 1 ? branches[0].id : ""

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "inventory", branchId: defaultBranchId || undefined },
  })

  function openInvite() {
    reset({ email: "", role: "inventory", branchId: defaultBranchId || undefined })
    setSuccessData(null)
    setIsOpen(true)
  }

  function closeDialog() {
    setIsOpen(false)
    setSuccessData(null)
    setCopied(false)
  }

  async function onSubmit(values: InviteInput) {
    const result = await inviteMemberAction(values)
    if (!result.ok) {
      if (result.error === "already_invited") {
        setError("email", { message: "This person already has a pending invite." })
      } else if (result.error === "branch_required") {
        setError("branchId", { message: "Please select a branch." })
      } else {
        toast.error(result.error)
      }
      return
    }
    setSuccessData({ acceptUrl: result.data.acceptUrl, emailSent: result.data.emailSent, email: values.email })
    router.refresh()
  }

  function copyLink() {
    if (!successData) return
    navigator.clipboard.writeText(successData.acceptUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleRevoke(inviteId: string) {
    if (confirmRevoke !== inviteId) {
      setConfirmRevoke(inviteId)
      return
    }
    setRevoking(true)
    const result = await revokeInviteAction(inviteId)
    setRevoking(false)
    setConfirmRevoke(null)
    if (result.ok) {
      toast.success("Invite revoked")
      router.refresh()
    } else {
      toast.error("Failed to revoke invite")
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Team</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Manage who has access to {orgName}
          </p>
        </div>
        <button
          onClick={openInvite}
          className="inline-flex items-center gap-2 rounded-md bg-violet-700 px-4 h-10 text-sm font-medium text-white hover:bg-violet-800 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Invite member
        </button>
      </div>

      {/* Members */}
      <div>
        <h2 className="text-base font-semibold text-neutral-950 mb-3">Members</h2>
        {members.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-neutral-200/60">
            <Users className="h-8 w-8 text-neutral-300 mb-3" />
            <p className="text-sm text-neutral-500">No members found.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-neutral-200/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-100">
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Member
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Role
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Branch
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-neutral-950 truncate max-w-[200px]">
                        {m.name || m.email}
                      </p>
                      {m.name && (
                        <p className="text-xs text-neutral-500 truncate max-w-[200px]">{m.email}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <RoleBadge role={m.role} />
                    </td>
                    <td className="px-5 py-3.5 text-neutral-600">
                      {m.branchName ?? <span className="text-neutral-400">All branches</span>}
                    </td>
                    <td className="px-5 py-3.5 text-neutral-500">{formatDate(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending invites */}
      <div>
        <h2 className="text-base font-semibold text-neutral-950 mb-3">Pending invites</h2>
        {invites.length === 0 ? (
          <div className="bg-white rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm font-medium text-neutral-950">No pending invites</p>
            <p className="text-xs text-neutral-400 mt-1">Sent invites will appear here until accepted.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-neutral-200/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-100">
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Email
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Role
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Branch
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wide">
                    Expires
                  </th>
                  <th className="px-5 py-3 w-36" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {invites.map((inv) => (
                  <tr key={inv.id} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-neutral-700 text-xs">{inv.email}</td>
                    <td className="px-5 py-3.5">
                      <RoleBadge role={inv.role} />
                    </td>
                    <td className="px-5 py-3.5 text-neutral-600">
                      {inv.branchName ?? <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={inv.daysLeft <= 1 ? "text-red-600" : "text-neutral-500"}>
                        {inv.daysLeft}d left
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {confirmRevoke === inv.id ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-xs text-neutral-500">Revoke?</span>
                          <button
                            onClick={() => handleRevoke(inv.id)}
                            disabled={revoking}
                            className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            {revoking ? "…" : "Yes"}
                          </button>
                          <button
                            onClick={() => setConfirmRevoke(null)}
                            className="text-xs text-neutral-400 hover:text-neutral-600"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => handleRevoke(inv.id)}
                          className="text-xs font-medium text-neutral-400 hover:text-red-600 transition-colors"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite dialog */}
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {successData ? "Invite created" : "Invite a team member"}
            </DialogTitle>
          </DialogHeader>

          {successData ? (
            /* Success state */
            <div className="space-y-4 pt-1">
              {successData.emailSent ? (
                <p className="text-sm text-neutral-600">
                  Invitation email sent to{" "}
                  <span className="font-medium text-neutral-950">{successData.email}</span>.
                </p>
              ) : (
                <p className="text-sm text-neutral-600">
                  Email isn&apos;t configured yet — share this link directly:
                </p>
              )}

              <div>
                <Label className="text-xs text-neutral-500 mb-1.5 block">Accept link</Label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={successData.acceptUrl}
                    className="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700 font-mono truncate focus:outline-none"
                  />
                  <button
                    onClick={copyLink}
                    className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                  >
                    {copied ? (
                      <><Check className="h-3.5 w-3.5 text-green-600" /> Copied</>
                    ) : (
                      <><Copy className="h-3.5 w-3.5" /> Copy</>
                    )}
                  </button>
                </div>
              </div>

              <p className="text-xs text-neutral-400">Link expires in 7 days.</p>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => {
                    setSuccessData(null)
                    reset({ email: "", role: "inventory", branchId: defaultBranchId || undefined })
                  }}
                  className="text-sm font-medium text-violet-700 hover:underline"
                >
                  Invite another
                </button>
                <Button onClick={closeDialog} variant="outline" className="rounded-md text-sm h-9">
                  Done
                </Button>
              </div>
            </div>
          ) : (
            /* Invite form */
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-1">
              <div>
                <Label htmlFor="email" className="text-sm font-medium text-neutral-700 mb-1.5 block">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="colleague@example.com"
                  className="rounded-md"
                  {...register("email")}
                />
                {errors.email && (
                  <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="role" className="text-sm font-medium text-neutral-700 mb-1.5 block">
                  Role
                </Label>
                <select id="role" className={SELECT_CLASS} {...register("role")}>
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {errors.role && (
                  <p className="mt-1 text-xs text-red-600">{errors.role.message}</p>
                )}
              </div>

              {branches.length > 1 && (
                <div>
                  <Label htmlFor="branchId" className="text-sm font-medium text-neutral-700 mb-1.5 block">
                    Branch
                  </Label>
                  <select id="branchId" className={SELECT_CLASS} {...register("branchId")}>
                    <option value="">Select branch…</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  {errors.branchId && (
                    <p className="mt-1 text-xs text-red-600">{errors.branchId.message}</p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeDialog}
                  className="rounded-md text-sm h-9"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-md bg-violet-700 hover:bg-violet-800 text-white text-sm h-9"
                >
                  {isSubmitting ? "Sending…" : "Send invite"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
