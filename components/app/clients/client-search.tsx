"use client"

import { useState, useEffect, useRef } from "react"
import { Search, X } from "lucide-react"
import { searchClientsAction } from "@/lib/db/actions/clients"
import type { Client } from "@/lib/db/queries/clients"

type Props = {
  value: Client | null
  onChange: (client: Client | null) => void
  placeholder?: string
  error?: string
}

export function ClientSearch({
  value,
  onChange,
  placeholder = "Search by name or member ID…",
  error,
}: Props) {
  const [query, setQuery]       = useState("")
  const [results, setResults]   = useState<Client[]>([])
  const [isOpen, setIsOpen]     = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([])
      setIsOpen(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setIsSearching(true)
      const data = await searchClientsAction(query)
      if (!cancelled) {
        setResults(data)
        setIsOpen(true)
        setIsSearching(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  if (value) {
    return (
      <div
        className={`flex items-center justify-between rounded-md border bg-white px-3 h-9 text-sm ${
          error ? "border-red-400" : "border-neutral-300"
        }`}
      >
        <div className="min-w-0 flex items-center gap-2">
          <span className="font-medium text-neutral-950 truncate">{value.name}</span>
          {value.memberId && (
            <span className="text-xs font-mono text-neutral-400 shrink-0">{value.memberId}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
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
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setIsOpen(true) }}
          placeholder={placeholder}
          className={`w-full rounded-md border bg-white pl-8 pr-3 h-9 text-sm text-neutral-950 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-700 focus:border-violet-700 ${
            error ? "border-red-400" : "border-neutral-300"
          }`}
        />
        {isSearching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">…</span>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-md overflow-hidden max-h-56 overflow-y-auto">
          {results.map((client) => (
            <button
              key={client.id}
              type="button"
              onClick={() => {
                onChange(client)
                setQuery("")
                setIsOpen(false)
              }}
              className="w-full text-left flex items-center justify-between px-3 py-2.5 hover:bg-neutral-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-950">{client.name}</p>
                {client.phone && (
                  <p className="text-xs text-neutral-400 font-mono">{client.phone}</p>
                )}
              </div>
              {client.memberId && (
                <span className="text-xs font-mono text-neutral-400 ml-3 shrink-0">
                  {client.memberId}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {isOpen && !isSearching && results.length === 0 && query.trim().length >= 1 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-md px-3 py-3">
          <p className="text-sm text-neutral-400">No clients found for "{query}".</p>
        </div>
      )}
    </div>
  )
}
