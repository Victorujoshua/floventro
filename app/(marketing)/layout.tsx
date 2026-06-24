import Nav from "@/components/marketing/nav"
import Footer from "@/components/marketing/footer"
import { WaitlistModalProvider } from "@/components/marketing/waitlist-modal"

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <WaitlistModalProvider>
      <Nav />
      {children}
      <Footer />
    </WaitlistModalProvider>
  )
}
