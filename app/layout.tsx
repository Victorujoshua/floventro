import type { Metadata, Viewport } from "next"
import { Instrument_Serif, JetBrains_Mono, Inter } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
})

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
})

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://floventro.com"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Floventro — Inventory that moves with your business",
    template: "%s · Floventro",
  },
  description:
    "Track every product movement across every branch — from vendor delivery to customer sale or service application. Multi-branch inventory built for modern operations.", // TODO(copy)
  openGraph: {
    title: "Floventro — Inventory that moves with your business",
    description:
      "Track every product movement across every branch — from vendor delivery to customer sale or service application.", // TODO(copy)
    type: "website",
    url: siteUrl,
    siteName: "Floventro",
    images: [{ url: "/asset/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Floventro — Inventory that moves with your business",
    description:
      "Track every product movement across every branch — from vendor delivery to customer sale or service application.", // TODO(copy)
    images: ["/asset/og-image.png"],
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F5F1EA",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${jetbrainsMono.variable} ${inter.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
