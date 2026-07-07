import { Container } from "@/components/ui/container"
import { Reveal } from "@/components/ui/reveal"
import FoundingPlayer from "@/components/ui/founding-player"
import { GetStartedButton } from "@/components/marketing/get-started-button"

export default function FoundingMembersDark() {
  return (
    <section id="founders" className="py-20 md:py-24 bg-black-deep text-cream">
      <Container>
        <div className="grid md:grid-cols-[1.4fr_1fr] gap-12 items-center">
          {/* ── Left column ── */}
          <div>
            <p className="font-mono text-mono-eyebrow text-cream/60">
              &gt; founding members
            </p>

            <Reveal>
              <h2 className="mt-6 font-sans font-bold text-[2.25rem] md:text-[48px] text-cream leading-[1.05] tracking-[-0.02em]">
                Be among the first 100.
                <br />
                Help shape what Floventro becomes.
                {/* TODO(copy) */}
              </h2>
            </Reveal>

            <Reveal delay={0.08}>
              <div className="mt-10 max-w-[520px] space-y-4 text-body text-cream/70 leading-[1.7]">
                <p>
                  Our founding cohort gets lifetime 50% off, a direct line to the team, and
                  first access to every new feature — before anyone else sees it.
                  {/* TODO(copy) */}
                </p>
                <p>
                  We&apos;re not just looking for early users. We want partners who care about
                  getting inventory right, and are willing to tell us when we get it wrong.
                  {/* TODO(copy) */}
                </p>
              </div>
            </Reveal>

            <div className="mt-10">
              <GetStartedButton variant="primary-on-dark">Get started →</GetStartedButton>
            </div>
          </div>

          {/* ── Right column — founding motion ── */}
          <div className="flex justify-center items-center mt-8 md:mt-0">
            <div className="w-[260px] md:w-[360px]">
              <FoundingPlayer />
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
