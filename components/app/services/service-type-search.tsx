"use client"

import { useState, useRef, useEffect } from "react"
import { Search, X, Plus } from "lucide-react"
import { createServiceTypeAction } from "@/lib/db/actions/services"
import type { ServiceType } from "@/lib/db/queries/services"

type Props = {
  value: string
  onChange: (id: string) => void
  serviceTypes: ServiceType[]
  canCreate: boolean
  onCreated: (st: ServiceType) => void
  error?: string
}

export function ServiceTypeSearch({ value, onChange, serviceTypes, canCreate, onCreated, error }: Props) {
  const [query, setQuery]     = useState("")
  const [isOpen, setIsOpen]   = useState(false)
  const [creating, setCreating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = serviceTypes.find((st) => st.id === value)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const trimmed = query.trim()
  const filtered = trimmed.length === 0
    ? serviceTypes
    : serviceTypes.filter((st) => st.name.toLowerCase().includes(trimmed.toLowerCase()))
  const hasExactMatch = serviceTypes.some((st) => st.name.toLowerCase() === trimmed.toLowerCase())
  const showCreate    = canCreate && trimmed.length > 0 && !hasExactMatch

  async function handleCreate() {
    if (!trimmed || creating) return
    setCreating(true)
    const result = await createServiceTypeAction({
      name: trimmed,
      description: "",
      defaultPriceNaira: 0,
      isActive: true,
    })
    setCreating(false)
    if (!result.ok) return
    const newType: ServiceType = {
      id: result.data.id,
      name: trimmed,
      description: null,
      defaultPriceCents: 0,
      isActive: true,
      createdAt: new Date().toISOString(),
    }
    onCreated(newType)
    onChange(newType.id)
    setQuery("")
    setIsOpen(false)
  }

  if (selected) {
    return (
      <div
        className={`flex items-center justify-between rounded-md border bg-white px-3 h-9 text-sm ${
          error ? "border-red-400" : "border-neutral-300"
        }`}
      >
        <span className="text-neutral-950 truncate">{selected.name}</span>
        <button
          type="button"
          onClick={() => onChange("")}
          className="shrink-0 ml-2 text-neutral-400 hover:text-neutral-700 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true) }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search services…"
          className={`w-full rounded-md border bg-white pl-8 pr-3 h-9 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 ${
            error ? "border-red-400" : "border-neutral-300"
          }`}
        />
      </div>

      {isOpen && (filtered.length > 0 || showCreate) && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-md overflow-hidden max-h-52 overflow-y-auto">
          {filtered.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => { onChange(st.id); setQuery(""); setIsOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-neutral-950 hover:bg-neutral-50 transition-colors"
            >
              {st.name}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              disabled={creating}
              onClick={handleCreate}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-violet-700 hover:bg-violet-50 border-t border-neutral-100 transition-colors disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              {creating ? "Creating…" : `Create "${trimmed}"`}
            </button>
          )}
        </div>
      )}

      {isOpen && filtered.length === 0 && !showCreate && trimmed.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-md px-3 py-3">
          <p className="text-sm text-neutral-400">No services match.</p>
        </div>
      )}
    </div>
  )
}
