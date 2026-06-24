/**
 * Playwright screenshot capture for visual QA.
 * Usage:
 *   pnpm screenshot                    — all sections, desktop + mobile
 *   pnpm screenshot:section hero       — single section
 *
 * Requires: pnpm dlx playwright install chromium
 * Server must be running at http://localhost:3000
 */

import { chromium } from "playwright"
import * as path from "path"
import * as fs from "fs"

const BASE_URL = "http://localhost:3000"
const OUT_DIR = path.join(process.cwd(), "screenshots")

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
] as const

const SECTIONS = [
  { id: "hero", label: "hero" },
  { id: "stats", label: "stats" },
  { id: "problem", label: "problem" },
  { id: "what", label: "what" },
  { id: "where", label: "where" },
  { id: "founders", label: "founders" },
] as const

async function main() {
  const sectionArg = process.argv.includes("--section")
    ? process.argv[process.argv.indexOf("--section") + 1]
    : null

  const sections = sectionArg
    ? SECTIONS.filter((s) => s.label === sectionArg)
    : SECTIONS

  if (sectionArg && sections.length === 0) {
    console.error(`Unknown section: ${sectionArg}`)
    console.error(`Available sections: ${SECTIONS.map((s) => s.label).join(", ")}`)
    process.exit(1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser = await chromium.launch()

  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
    })

    await page.goto(BASE_URL, { waitUntil: "networkidle" })

    // Full-page capture
    const fullPath = path.join(OUT_DIR, `${viewport.name}-full.png`)
    await page.screenshot({ path: fullPath, fullPage: true })
    console.log(`✓ ${viewport.name}-full.png`)

    // Per-section captures
    for (const section of sections) {
      const el = page.locator(`#${section.id}`)
      const count = await el.count()
      if (count === 0) {
        console.warn(`  ⚠ #${section.id} not found — skipping`)
        continue
      }

      await el.scrollIntoViewIfNeeded()
      await page.waitForTimeout(300) // let animations settle

      const outPath = path.join(OUT_DIR, `${viewport.name}-${section.label}.png`)
      await el.screenshot({ path: outPath })
      console.log(`✓ ${viewport.name}-${section.label}.png`)
    }

    await page.close()
  }

  await browser.close()
  console.log(`\nAll screenshots saved to ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
