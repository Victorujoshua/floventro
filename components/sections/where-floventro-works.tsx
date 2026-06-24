import { Container } from "@/components/ui/container"
import { Reveal } from "@/components/ui/reveal"

const INDUSTRIES = [
  "Aesthetics", "Pharmacies", "Salons", "Retail Chains", "Distributors",
  "Spas", "Optical Stores", "Pet Stores", "Vet Clinics", "Hardware",
  "Auto Parts", "Cosmetics", "Wellness", "Fashion", "More…",
]

const ROLES = ["Owner", "Inventory", "Sales", "Internal Use"]

const TRACKED = [
  "Vendor invoices", "Stock movement", "Internal requests", "Sales",
  "Service usage", "Transfers", "Customer history", "Balances",
]

function MonoList({ items }: { items: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <span key={item} className="font-mono text-mono-eyebrow text-ink">
          {item}
        </span>
      ))}
    </div>
  )
}

export default function WhereFloventroWorks() {
  return (
    <section id="where" className="py-20 md:py-24 bg-cream">
      <Container>
        {/* Eyebrow — centered */}
        <p className="text-center font-mono text-mono-eyebrow text-ink-muted">
          &gt; where floventro works
        </p>

        <Reveal>
          <h2 className="mt-6 text-center font-sans font-bold text-[2.25rem] md:text-[48px] text-ink leading-[1.05] tracking-[-0.02em]">
            For multi-branch businesses.
            <br />
            In any industry.
            {/* TODO(copy) */}
          </h2>
        </Reveal>

        {/* Config-style panel */}
        <Reveal delay={0.08}>
          <div className="mt-20 max-w-[1000px] mx-auto bg-cream border rounded-lg p-8 md:p-12">
            <div className="space-y-10">
              {/* Industries */}
              <div>
                <p className="font-mono text-mono-eyebrow text-ink-muted tracking-[0.06em] uppercase">
                  Industries
                </p>
                <MonoList items={INDUSTRIES} />
              </div>

              {/* Roles */}
              <div>
                <p className="font-mono text-mono-eyebrow text-ink-muted tracking-[0.06em] uppercase">
                  Roles Supported
                </p>
                <MonoList items={ROLES} />
              </div>

              {/* What we track */}
              <div>
                <p className="font-mono text-mono-eyebrow text-ink-muted tracking-[0.06em] uppercase">
                  What We Track
                </p>
                <MonoList items={TRACKED} />
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
