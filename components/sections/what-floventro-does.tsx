import { Container } from "@/components/ui/container"
import { Reveal } from "@/components/ui/reveal"

const ITEMS = [
  {
    number: "01",
    heading: "Tracks every product, from delivery to consumption.",
    body: "Every vendor invoice becomes a receiving record. Every product that moves — to a branch, to a customer, or used in a service — is tracked against it. You always know where stock came from and where it went.",
  },
  {
    number: "02",
    heading: "Runs every branch as its own workspace.",
    body: "Each branch has its own product catalogue, vendor relationships, and team. Branches operate independently but report upward in real time. One platform, every location.",
  },
  {
    number: "03",
    heading: "Approves internal requests cleanly.",
    body: "Sales teams and service teams request stock from the Inventory team directly in the platform. Requests can be partially approved, fulfilled in stages, and tracked end-to-end — with a full audit trail.",
  },
  {
    number: "04",
    heading: "Moves stock between branches like a vendor invoice.",
    body: "Inter-branch transfers use the same mental model as receiving from a vendor. The sending branch dispatches; the receiving branch confirms. No custom workflow to learn.",
  },
  {
    number: "05",
    heading: "Gives owners the full picture, in real time.",
    body: "A cross-branch dashboard shows stock levels, pending requests, vendor balances, and movement history across every location — with the ability to drill into any branch at any time.",
  },
] as const

export default function WhatFloventroDoes() {
  return (
    <section id="what" className="py-20 md:py-24 bg-cream">
      <Container>
        <p className="font-mono text-mono-eyebrow text-ink-muted">
          &gt; what floventro does
        </p>

        <div className="mt-12">
          {ITEMS.map((item, i) => (
            <Reveal key={item.number} delay={i * 0.06}>
              <div
                className={[
                  "border-t border-l border-warm",
                  "py-12 px-6 md:py-20 md:pl-12 md:pr-6",
                  i === ITEMS.length - 1 ? "border-b" : "",
                ].join(" ")}
              >
                <div className="grid grid-cols-1 gap-6 md:grid-cols-[140px_1fr] md:gap-12 md:items-start">
                  {/* Number — oversized, receding */}
                  <p className="font-mono text-6xl md:text-7xl text-ink/25 leading-none">
                    {item.number}
                  </p>

                  {/* Heading + Body stacked in right column */}
                  <div>
                    <h3 className="font-sans font-bold text-3xl md:text-4xl text-ink leading-snug">
                      {item.heading}
                    </h3>
                    <p className="mt-6 text-body text-ink-muted leading-relaxed">
                      {item.body}
                    </p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  )
}
