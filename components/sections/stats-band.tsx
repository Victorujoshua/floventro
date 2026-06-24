import { Container } from "@/components/ui/container"
import { Reveal } from "@/components/ui/reveal"
import { CountUp } from "@/components/ui/count-up"

const STATS = [
  {
    to: 90,
    suffix: "%",
    label: "Reduction in stock-out incidents", // TODO(copy)
  },
  {
    to: 10,
    suffix: "×",
    label: "Faster stock reconciliation across branches", // TODO(copy)
  },
  {
    to: 4,
    suffix: "",
    label: "Roles. One real-time source of truth.", // TODO(copy)
  },
]

export default function StatsBand() {
  return (
    <section id="stats" className="py-16 bg-stat-band">
      <Container>
        <Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-ink/20">
            {STATS.map((stat) => (
              <div key={stat.to} className="px-0 py-8 md:py-0 md:px-12 first:pl-0 last:pr-0">
                <CountUp
                  to={stat.to}
                  suffix={stat.suffix}
                  className="font-sans font-bold text-[48px] text-ink leading-none"
                />
                <p className="mt-3 text-body-sm text-ink-muted max-w-[200px] leading-relaxed">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
