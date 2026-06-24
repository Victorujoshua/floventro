"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { Container } from "@/components/ui/container"
import WaitlistButton from "@/components/marketing/waitlist-button"

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 h-16 bg-cream",
        "transition-all duration-[var(--duration-base)] ease-[var(--ease-out)]",
        scrolled && "border-b border-warm",
      )}
    >
      <Container className="flex h-full items-center justify-between">
        <Image
          src="/asset/logo.svg"
          alt="Floventro"
          width={138}
          height={28}
          unoptimized
          priority
        />
        <WaitlistButton variant="primary">Join Waitlist →</WaitlistButton>
      </Container>
    </header>
  )
}
