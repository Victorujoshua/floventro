import { Container } from "@/components/ui/container"
import { GetStartedButton } from "@/components/marketing/get-started-button"
import HeroPlayer from "@/components/ui/hero-player"

const TAGS = [
  { label: "Aesthetics" },
  { label: "Pharmacies" },
  { label: "Salons" },
  { label: "Retail" },
  { label: "Distributors" },
  { label: "Spas" },
]

export default function Hero() {
  return (
    <section id="hero" className="pt-20 pb-16 md:pt-28 md:pb-20 bg-cream">
      <Container>
        <div className="grid md:grid-cols-[1.4fr_1fr] gap-12 items-start">
          {/* ── Left column ── */}
          <div>
            {/* Terminal eyebrow */}
            <div className="font-mono text-mono-eyebrow text-ink-muted leading-relaxed">
              <p>&gt;Pre-launch&nbsp;·&nbsp;early 2026<span className="cursor">█</span></p>
            </div>

            {/* H1 */}
            <h1 className="mt-10 font-serif text-display-1 text-ink leading-[1.0] tracking-[-0.02em]">
              We help you move stock,
              <br />
              <em className="italic">everywhere.</em>
              {/* TODO(copy) */}
            </h1>

            {/* Subhead */}
            <p className="mt-8 text-body-lg text-ink-muted max-w-[420px] leading-relaxed">
              The inventory operating system for multi-branch businesses - receiving,
              distribution, sales, and service tracking across every location.
              {/* TODO(copy) */}
            </p>

            {/* CTA */}
            <div className="mt-10">
              <GetStartedButton>Get started →</GetStartedButton>
            </div>

            {/* Category tag pills */}
            <div className="mt-10 flex flex-wrap gap-2">
              {TAGS.map((tag) => (
                <span
                  key={tag.label}
                  className="border border-ink/15 text-ink rounded-md px-3 h-8 text-mono-tag font-mono inline-flex items-center hover:bg-ink hover:text-cream transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]"
                >
                  {tag.label}
                </span>
              ))}
              <a
                href="#where"
                className="border border-ink/15 text-ink rounded-md px-3 h-8 text-mono-tag font-mono inline-flex items-center hover:bg-ink hover:text-cream transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]"
              >
                More →
              </a>
            </div>
          </div>

          {/* ── Right column — operations motion ── */}
          <div className="hidden md:flex justify-center items-start md:items-center mt-8 md:mt-0">
            <div className="w-[350px] md:w-[500px]">
              <HeroPlayer />
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
