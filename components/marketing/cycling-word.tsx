"use client"

import { useEffect, useRef, useState } from "react"

const PHRASES = [
  "everywhere.",
  "across branches.",
  "across departments.",
  "across organizations.",
  "across locations.",
]

const TYPE_MS = 95       // ms per keystroke forward
const DELETE_MS = 48     // ms per keystroke backward (faster)
const PAUSE_FULL_MS = 2200  // pause when phrase is fully typed
const PAUSE_EMPTY_MS = 480  // pause before typing next phrase

export function CyclingWord() {
  const [text, setText] = useState("")
  const phraseIdx = useRef(0)
  const charIdx = useRef(0)
  const deleting = useRef(false)

  useEffect(() => {
    let id: ReturnType<typeof setTimeout>

    const tick = () => {
      const phrase = PHRASES[phraseIdx.current]

      if (!deleting.current) {
        charIdx.current += 1
        setText(phrase.slice(0, charIdx.current))

        if (charIdx.current === phrase.length) {
          deleting.current = true
          id = setTimeout(tick, PAUSE_FULL_MS)
        } else {
          id = setTimeout(tick, TYPE_MS)
        }
      } else {
        charIdx.current -= 1
        setText(phrase.slice(0, charIdx.current))

        if (charIdx.current === 0) {
          deleting.current = false
          phraseIdx.current = (phraseIdx.current + 1) % PHRASES.length
          id = setTimeout(tick, PAUSE_EMPTY_MS)
        } else {
          id = setTimeout(tick, DELETE_MS)
        }
      }
    }

    id = setTimeout(tick, TYPE_MS)
    return () => clearTimeout(id)
  }, [])

  return (
    <span className="text-ink">
      {text}
      <span className="cursor text-brand-coral">█</span>
    </span>
  )
}
