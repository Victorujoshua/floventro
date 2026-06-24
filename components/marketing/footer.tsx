import Image from "next/image"
import { Container } from "@/components/ui/container"
import WaitlistButton from "@/components/marketing/waitlist-button"
import { LiveTime } from "@/components/marketing/live-time"

export default function Footer() {
  return (
    <footer className="bg-cream border-t border-warm py-16">
      <Container>
        {/* Top row — logo */}
        <div className="flex items-center justify-between">
          <Image
            src="/asset/logo.svg"
            alt="Floventro"
            width={138}
            height={28}
            unoptimized
          />
        </div>

        {/* Contact + location row */}
        <div className="mt-10 flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-mono text-mono-eyebrow text-ink-muted">&gt; contact</p>
            <a
              href="mailto:hello@floventro.com"
              className="mt-2 block text-body text-ink-muted hover:text-ink transition-colors duration-[var(--duration-fast)]"
            >
              hello@floventro.com{/* TODO(copy) confirm email */}
            </a>
          </div>

          <div className="md:text-right">
            <p className="font-mono text-mono-eyebrow text-ink-muted">
              Lagos, Nigeria · <LiveTime />
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 flex justify-center">
          <WaitlistButton variant="primary">Join Waitlist →</WaitlistButton>
        </div>

        {/* Legal */}
        <div className="mt-10 flex justify-center gap-6">
          <a
            href="#"
            className="font-mono text-mono-eyebrow text-ink-muted hover:text-ink transition-colors duration-[var(--duration-fast)]"
          >
            Terms of Service
          </a>
          <a
            href="#"
            className="font-mono text-mono-eyebrow text-ink-muted hover:text-ink transition-colors duration-[var(--duration-fast)]"
          >
            Privacy Policy
          </a>
        </div>
      </Container>
    </footer>
  )
}
