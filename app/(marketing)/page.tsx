import Hero from "@/components/sections/hero"
import StatsBand from "@/components/sections/stats-band"
import TheProblem from "@/components/sections/the-problem"
import WhatFloventroDoes from "@/components/sections/what-floventro-does"
import WhereFloventroWorks from "@/components/sections/where-floventro-works"
import FoundingMembersDark from "@/components/sections/founding-members-dark"

export default function Home() {
  return (
    <main>
      <Hero />
      <StatsBand />
      <TheProblem />
      <WhatFloventroDoes />
      <WhereFloventroWorks />
      <FoundingMembersDark />
    </main>
  )
}
