# Floventro — Project Context

> This file is read by Claude Code on every task. Keep it short, accurate, and current.

---

## 1. What we're building

Floventro is a multi-tenant inventory and distribution platform for businesses
operating across one or many branches. It tracks every product movement from
vendor delivery to final consumption — whether sold to a customer or applied
during a service.

This repo currently contains the **public marketing site + waitlist** for
pre-launch.

**Reference for landing page:** payna.com — editorial publishing language,
not B2B SaaS. Serif headlines with italic emphasis, monospace meta info,
cream background, near-total monochrome, generous whitespace.
Local reference image: `/public/asset/model.png`.

---

## 2. Brand system (source of truth)

This section is locked. Any generated output must reconcile to this before
commit. See § 6 for reconciliation rules.

### Colors

| Token       | Hex       | Tailwind class           | Usage                                |
|-------------|-----------|--------------------------|--------------------------------------|
| Cream       | `#F5F1EA` | `bg-cream`               | Page background                      |
| Ink         | `#151D27` | `text-ink`, `bg-ink`     | Primary text, dark accents           |
| Ink Muted   | `#5C6068` | `text-ink-muted`         | Body subtext, meta                   |
| Border      | `#E5E0D6` | `border-warm`            | Warm-toned thin borders              |
| Stat Band   | `#EBE5DA` | `bg-stat-band`           | Stats strip background (slightly darker cream) |
| Black       | `#0A0A0A` | `bg-black-deep`          | Dark closing section background      |
| White       | `#FFFFFF` | `bg-white`               | Modal surfaces, button hover states  |

**Logo accent colors (live ONLY inside the logo SVG, nowhere else on the page):**
- `#4A02C8` — logo violet
- `#F95F3D → #F76540` gradient — logo coral

**Rules:**
- The page is monochrome ink-on-cream. No saturated color except the logo mark itself.
- No gradients. No shadows (except minimal `box-shadow` for the modal).
- Buttons are solid `bg-ink text-cream` or outlined `border-ink text-ink`.

### Typography

| Use                 | Font              | Weight       | Notes                          |
|---------------------|-------------------|--------------|--------------------------------|
| Display / headlines | Instrument Serif  | 400, 400 italic | Google Fonts. Italic is essential. |
| Meta / eyebrows / lists | JetBrains Mono | 400, 500    | Google Fonts                   |
| Body / sans         | Inter             | 400, 500     | Google Fonts                   |

**Italic emphasis is the brand signature.** Headlines mix regular serif with
italicized emphasis words — `We help you move money,` then italic `everywhere.`
Always put the italic emphasis word(s) on its own line where possible.

**Type scale (desktop):**
- `display-1`: 80px / 1.0 / -0.02em — hero only, Instrument Serif 400
- `display-2`: 56px / 1.05 / -0.02em — section headers
- `display-3`: 36px / 1.1 / -0.01em — sub-section
- `mono-eyebrow`: 13px / 1.4 / 0 — monospace, lowercase `> the problem` style
- `mono-tag`: 12px / 1.2 / 0 — monospace, pill tags
- `body-lg`: 17px / 1.6 — section lede, Inter regular
- `body`: 15px / 1.6 — default
- `body-sm`: 13px / 1.5 — captions

Mobile: reduce display sizes by ~30%.

**Italic rule:** any sentence-internal emphasis is `italic` Instrument Serif.
Never bold, never underline.

### Spacing & layout

- Max content width: `1120px` (`max-w-[1120px]`). Tighter than Deel — Payna feels narrower.
- Section vertical padding: `py-32 md:py-40` for primary sections. Generous.
- Container horizontal padding: `px-6 md:px-12`
- Default vertical rhythm between elements: `mt-6` for paragraphs, `mt-10` for new blocks
- Text is left-aligned almost everywhere. Center only the "Where Floventro Works" headline.

### Components

Use **shadcn/ui** only for the modal/dialog (waitlist form). Everything else
is hand-written — Payna's design has no card chrome, no rounded shadows, no
component framework feel. Plain markup is the point.

Buttons:
- Primary: `bg-ink text-cream rounded-md px-5 h-11 text-sm font-medium`. Arrow `→` appended in label.
- Outline: `border border-ink/20 text-ink rounded-md px-5 h-11 text-sm`
- Inline link: `text-ink underline-offset-4 hover:underline`
- All buttons: subtle `active:scale-[0.98]` press feedback, no other animation.

Pills (category tags):
- `border border-ink/15 text-ink rounded-md px-3 h-8 text-xs font-mono inline-flex items-center`
- Hover: `bg-ink text-cream`. 150ms transition.
- Selected state: `bg-ink text-cream`.

### Icons

Default: no icons inline. Payna's design uses almost zero icons in body.
The only icons allowed:
- Arrow `→` in CTAs and link endings — use the literal Unicode character, not a Lucide component.
- Blinking cursor block `█` after `W26` in hero eyebrow — CSS animation, no JS.
If a real icon is genuinely needed elsewhere, use **Lucide outline**.

---

## 3. Tech stack

| Layer            | Choice                                |
|------------------|---------------------------------------|
| Framework        | Next.js 16 (App Router, TypeScript)   |
| Styling          | Tailwind CSS v4                       |
| Components       | shadcn/ui (only Dialog for modal)     |
| Forms            | React Hook Form + Zod                 |
| Animation        | Framer Motion (minimal — see § 6)     |
| Database         | Supabase (Postgres)                   |
| Email            | Loops                                 |
| Analytics        | Vercel Analytics                      |
| Screenshot       | Playwright (for iteration loop)       |
| Hosting          | Vercel                                |

---

## 4. Project structure

```
/app
  /(marketing)
    /page.tsx
    /layout.tsx
  /api/waitlist/route.ts
  /layout.tsx
  /globals.css
/components
  /sections        # one file per section
  /ui              # shadcn primitives (Dialog only for now)
  /marketing       # Nav, Footer, WaitlistModal, WaitlistButton
/design-system
  /MASTER.md
  /motion.md
  /pages/{section}.md
/lib
  /supabase
  /email
  /validation
/public
  /asset
    /model.png         # the Payna reference image
    /logo.svg          # the Floventro logo (from Frame_1.svg)
    /illustration.svg  # placeholder ring-of-boxes illustration
/scripts
  /screenshot.ts       # Playwright capture script
/screenshots
  /desktop-{section}.png
  /mobile-{section}.png
```

---

## 5. Conventions

- TypeScript strict. No `any`.
- Server components by default; `"use client"` only when needed (waitlist modal trigger).
- Imports via `@/` alias.
- Files: kebab-case. Components: PascalCase.
- Forms: Zod → React Hook Form → route handler. Validate both sides.
- API routes return `{ok: boolean, error?: string}`. No throws.
- No magic strings — all design tokens in `tailwind.config.ts` and `globals.css`.

---

## 6. Tooling & workflow

### Tool layers

| Layer        | Tool                       | Role                                                                 |
|--------------|----------------------------|----------------------------------------------------------------------|
| Strategy     | UI UX Pro Max skill        | Generates `design-system/MASTER.md` once.                            |
| Primitives   | shadcn/ui                  | Dialog/Modal only. Nothing else.                                     |
| Scaffolding  | 21st.dev Magic (`/ui`)     | **Largely unused for this design.** Payna's aesthetic is hand-written; `/ui` outputs default to over-designed B2B chrome that fights this look. Use only for the modal interior. |
| Motion polish | emil-design-eng skill     | Motion decisions, easing, durations. Minimal motion on this site.    |
| Visual QA    | Playwright screenshot loop | After each section: capture, compare to `/public/asset/model.png`, iterate. |

### Decision rules

- Every task starts by reading `design-system/MASTER.md` and `design-system/motion.md`.
- **Hand-write everything in Phase 4 sections.** No `/ui` calls in section components — they will add SaaS chrome we don't want.
- Use `/ui` only for the modal interior in 4.7.
- When § 2 and `design-system/MASTER.md` conflict, **§ 2 wins**.

### Brand reconciliation (non-negotiable)

Generated output must reconcile to § 2 before commit:
- Colors: Cream / Ink / Ink Muted / Border / Stat Band / Black only. Logo violet and coral only inside the logo SVG.
- Fonts: Instrument Serif (display) / JetBrains Mono (meta) / Inter (body) only.
- No gradients on the page (modal can use a subtle one if needed). No drop shadows except modal.
- No emoji. No filled icons. No marquees.
- Italic emphasis is brand-essential — never delete it from headlines.

### Motion rules (from emil-design-eng)

Payna's design is nearly static. Motion is restrained on purpose.

In `app/globals.css`:
```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --duration-fast: 150ms;
  --duration-base: 200ms;
  --duration-slow: 300ms;
}
```

Rules:
- Never use `ease-in`.
- UI animations ≤ 300ms.
- Animate `transform` and `opacity` only. Never width/height/top/left/margin/padding.
- Section reveals: opacity 0→1 + translateY 12px→0, 400ms, ease-out. Triggered once on viewport entry. Section headers + numbered list items only.
- Cursor blink in hero terminal eyebrow: pure CSS, 1s steps, infinite.
- Button hover/active: `transition-all 150ms ease-out`, press `scale(0.98)`.
- Modal: fade backdrop 200ms, modal slide up 8px + fade 250ms ease-out.
- Respect `prefers-reduced-motion` — skip all reveals, freeze cursor.

### Visual QA loop (the "100% look-alike" workflow)

This is the only realistic way to converge on a pixel-accurate clone.

1. After each section in Phase 4 is built, run `pnpm screenshot`.
2. Script outputs `screenshots/desktop-{section}.png` and `screenshots/mobile-{section}.png`.
3. Manually compare against `/public/asset/model.png` at the corresponding region.
4. Feed deltas back to Claude Code with specifics (e.g. "hero headline is 64px, should be 80px; subhead margin-top is too tight; tag pills have rounded-full but should be rounded-md").
5. Loop until structural match. Expect 2–3 iterations per section to get to ~90% match.
6. The last 10% (letter-spacing, optical alignment) is hand-tuning — don't chase it via Claude Code.

---

## 7. Commands

```bash
# Development
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm typecheck

# shadcn
pnpm dlx shadcn@latest add dialog

# Supabase types
pnpm dlx supabase gen types typescript --project-id $SUPABASE_PROJECT_ID > types/supabase.ts

# UI UX Pro Max — generate design system (run once)
python3 .claude/skills/ui-ux-pro-max/scripts/search.py \
  "editorial publishing fintech compliance B2B" \
  --design-system --persist -p "Floventro"

# Playwright screenshot iteration
pnpm dlx playwright install chromium
pnpm screenshot                 # captures desktop + mobile of every section
pnpm screenshot:section hero    # captures one section only
```

---

## 8. Environment variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Loops
LOOPS_API_KEY=
LOOPS_WAITLIST_TRANSACTIONAL_ID=

# Site
NEXT_PUBLIC_SITE_URL=https://floventro.com
```

All vars must be set in **Vercel project settings** before deploy.

---

## 9. Known gotchas

- **Windows `.next` cache corruption:** `rm -rf .next` and restart if dev server misbehaves.
- **Tailwind v4 + shadcn:** ensure shadcn is the v4-compatible variant.
- **`cookies()` is async** in Next.js 15+. Always `await`.
- **Instrument Serif italic** is a separate font file in `next/font/google` — must explicitly list `style: ['normal', 'italic']` in the font config or italics won't load.
- **Playwright in CI:** the screenshot script runs against `pnpm dev` on localhost:3000 — start the server before running.

---

## 10. Working style with the project owner

- The owner (Olawale) provides exact copy and design specs.
- When in doubt, leave `// TODO(copy)` or `// TODO(design)` placeholders.
- Prefer small, reviewable commits.
- For Phase 4: after every section, run the screenshot script and stop for review before proceeding.
