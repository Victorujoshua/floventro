import { Container } from "@/components/ui/container"
import { Reveal } from "@/components/ui/reveal"
import { FileSpreadsheet, PackageX, AlertTriangle } from "lucide-react"

const PROBLEMS = [
  {
    icon: FileSpreadsheet,
    title: "Spreadsheets can't keep up",
    body: "Every stock movement typed manually. By the time you open the sheet, the numbers are already wrong.", // TODO(copy)
  },
  {
    icon: PackageX,
    title: "No visibility across branches",
    body: "Products sit idle in the wrong location while other branches run out. Nobody knows until it's too late.", // TODO(copy)
  },
  {
    icon: AlertTriangle,
    title: "Decisions made on bad data",
    body: "Sales commits stock that isn't there. Inventory counts what hasn't moved. Teams work from different numbers.", // TODO(copy)
  },
]

export default function TheProblem() {
  return (
    <section id="problem" className="py-20 md:py-24 bg-cream">
      <Container>
        <p className="font-mono text-mono-eyebrow text-ink-muted">&gt; the problem</p>

        <Reveal>
          <h2 className="mt-6 font-sans font-bold text-[2.25rem] md:text-[48px] text-ink max-w-[800px] leading-[1.05] tracking-[-0.02em]">
            You&apos;re tracking inventory across branches with spreadsheets and memory.
            {/* TODO(copy) */}
          </h2>
        </Reveal>

        <Reveal delay={0.06}>
          <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-px border border-ink/20">
            {PROBLEMS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="border-r border-ink/20 last:border-r-0 p-8 bg-cream">
                <Icon className="w-10 h-10 text-ink" strokeWidth={1.25} />
                <h3 className="mt-5 font-sans font-bold text-[20px] text-ink leading-snug tracking-[-0.01em]">
                  {title}
                </h3>
                <p className="mt-3 text-[16px] text-ink-muted leading-relaxed">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
