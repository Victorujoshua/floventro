# Floventro — Build Plan v3 (Payna-Cloned Landing Page + Waitlist)

> This supersedes the previous BUILD.md. The landing page now mirrors payna.com.
> Reference image: `/public/asset/model.png`.
> Each task is a self-contained Claude Code prompt. Run in order.

---

## Workflow

Every section task starts by reading:
1. `CLAUDE.md` (brand + conventions)
2. `design-system/MASTER.md`
3. `design-system/motion.md`

After each Phase 4 section: run `pnpm screenshot`, compare to `/public/asset/model.png`,
report deltas, iterate until ~90% structural match.

---

## Phase 1 — Foundation

### 1.1 ✓ Project init (done — keep)
### 1.2 ✓ Old tokens & fonts (DONE BUT NEEDS REWORK — see 1.4 below)

### 1.3 Folder structure & marketing route group

**Prompt:**
> Create the folder structure per `CLAUDE.md § 4`. Specifically:
>
> 1. Move home page into `(marketing)` route group: `app/(marketing)/layout.tsx` and `app/(marketing)/page.tsx`. Marketing layout renders `<Nav />` above `{children}` and `<Footer />` below.
> 2. Create placeholder files for every section component:
>    - `components/sections/hero.tsx`
>    - `components/sections/stats-band.tsx`
>    - `components/sections/the-problem.tsx`
>    - `components/sections/what-floventro-does.tsx`
>    - `components/sections/where-floventro-works.tsx`
>    - `components/sections/founding-members-dark.tsx`
> 3. Create `components/marketing/nav.tsx`, `footer.tsx`, `waitlist-modal.tsx`, `waitlist-button.tsx`.
> 4. Create `lib/supabase/{client,server}.ts`, `lib/email/zeptomail.ts`, `lib/validation/waitlist.ts` as placeholders.
> 5. Create `design-system/` with empty `pages/` subfolder.
> 6. Create `/public/asset/` and confirm `model.png` and `logo.svg` exist there. The user's logo file was uploaded as `Frame 1.svg` — rename to `logo.svg` if needed.
> 7. Create `/screenshots/` directory (gitignored).

### 1.4 Rebuild design tokens, fonts, globals (REPLACES OLD 1.2)

**Prompt:**
> Replace the old brand tokens with the new Payna-style system per `CLAUDE.md § 2`.
>
> 1. In `app/layout.tsx`, load fonts via `next/font/google`:
>    - `Instrument_Serif` with weights `['400']`, styles `['normal', 'italic']`. CSS var `--font-serif`.
>    - `JetBrains_Mono` with weights `['400', '500']`. CSS var `--font-mono`.
>    - `Inter` with weights `['400', '500']`. CSS var `--font-sans`.
> 2. In `app/globals.css`:
>    - Define CSS vars for all colors in `CLAUDE.md § 2` (`--cream`, `--ink`, `--ink-muted`, `--border-warm`, `--stat-band`, `--black-deep`).
>    - Define motion vars (`--ease-out`, `--ease-in-out`, durations) per `CLAUDE.md § 6`.
>    - Body defaults: `font-family: var(--font-sans)`, color `var(--ink)`, background `var(--cream)`, antialiased.
>    - Utility classes: `.font-serif` (Instrument Serif), `.font-mono` (JetBrains Mono).
>    - Cursor blink keyframes: `@keyframes blink { 50% { opacity: 0 } }` applied to `.cursor` with `animation: blink 1s steps(1) infinite;`.
> 3. In `tailwind.config.ts`:
>    - Extend `colors`: `cream`, `ink`, `'ink-muted'`, `'border-warm'`, `'stat-band'`, `'black-deep'`.
>    - Extend `fontFamily`: `serif: ['var(--font-serif)']`, `mono: ['var(--font-mono)']`, `sans: ['var(--font-sans)']`.
>    - Extend `maxWidth`: `'content': '1120px'`.
>    - Extend `fontSize` per type scale in CLAUDE.md § 2 (`display-1`, `display-2`, `display-3`, `mono-eyebrow`, `mono-tag`, `body-lg`, `body`, `body-sm`).
> 4. Create `components/ui/container.tsx`: `max-w-content mx-auto px-6 md:px-12`.
> 5. Delete the old Tailwind tokens for `violet`, `coral`, `obsidian`, `alabaster`. They are no longer part of the page (logo SVG retains those colors internally only).
>
> Verify by rendering `<h1 className="font-serif text-[80px]">Test <em className="italic">italic</em></h1>` on the home page — confirm Instrument Serif loads and italic looks distinctive.

---

## Phase 2 — Backend (waitlist plumbing — unchanged from v2)

### 2.1 Supabase setup & waitlist schema

**Prompt:**
> Set up Supabase for the waitlist:
>
> 1. SQL migration `supabase/migrations/0001_waitlist.sql`:
>    ```sql
>    create table public.waitlist (
>      id uuid primary key default gen_random_uuid(),
>      email text not null unique,
>      full_name text,
>      company text,
>      role text,
>      branch_count text,
>      referrer text,
>      utm_source text, utm_medium text, utm_campaign text,
>      created_at timestamptz not null default now(),
>      confirmed_at timestamptz
>    );
>    create index waitlist_created_at_idx on public.waitlist(created_at desc);
>    alter table public.waitlist enable row level security;
>    ```
> 2. `lib/supabase/server.ts` → `createServerSupabase()` with service role key.
> 3. `lib/supabase/client.ts` → `createBrowserSupabase()` with anon key.
> 4. Generate types into `types/supabase.ts`.

### 2.2 Waitlist API route

**Prompt:**
> Build `app/api/waitlist/route.ts`:
>
> 1. `lib/validation/waitlist.ts` — Zod schema (email required; fullName, company, branchCount, utm_* optional).
> 2. POST handler:
>    - Validate. Invalid → 400 `{ok:false,error:'invalid'}`.
>    - Insert. Unique violation → 200 `{ok:true,alreadyOnWaitlist:true}`.
>    - New insert → call `sendWaitlistConfirmation()` then 200 `{ok:true}`.
>    - Unknown errors → 500 `{ok:false,error:'server'}` and log.
> 3. In-memory rate limit: 5 req/min per IP.

### 2.3 Loops email integration

**Prompt:**
> Implement `lib/email/loops.ts`:
>
> 1. Export `addWaitlistContact(payload)`. POST to `https://app.loops.so/api/v1/contacts/create` — adds subscriber to Loops for future broadcasts. 409 → `{ok:true,alreadyExists:true}`. Non-2xx → log + `{ok:false}`.
> 2. Export `sendWaitlistConfirmation(email, firstName?)`. POST to `https://app.loops.so/api/v1/transactional` using `LOOPS_WAITLIST_TRANSACTIONAL_ID`. Non-2xx → log + `{ok:false}`.
> 3. Both functions: never throw. Fire-and-forget from the route handler — failures are logged but don't block the success response.
> 4. Required env vars: `LOOPS_API_KEY`, `LOOPS_WAITLIST_TRANSACTIONAL_ID`.

---

## Phase 3 — Shell, design system, nav, footer, screenshot setup

### 3.1 Root layout & global metadata

**Prompt:**
> Update `app/layout.tsx` per `CLAUDE.md § 2`:
>
> - Metadata: title default `Floventro — Inventory and distribution, made simple`, description // TODO(copy), OG image `/asset/og-image.png` (1200×630, placeholder for now), Twitter `summary_large_image`.
> - `themeColor: '#F5F1EA'`.
> - Apply font variable classes to `<body>`.
> - Wrap children in Sonner `<Toaster />` (positioned bottom-right, styled minimally).

### 3.2 Generate design system

**Prompt:**
> Run UI UX Pro Max with editorial fintech inputs:
> ```bash
> python3 .claude/skills/ui-ux-pro-max/scripts/search.py \
>   "editorial publishing fintech compliance B2B" \
>   --design-system --persist -p "Floventro"
> ```
>
> Review `design-system/MASTER.md`. Immediately reconcile:
> - Any color recommendation not in CLAUDE.md § 2 → strip or replace.
> - Any font recommendation not Instrument Serif / JetBrains Mono / Inter → strip.
> - Keep pattern + anti-pattern recommendations as-is — those are the value.
>
> Add header note: "Brand tokens locked in CLAUDE.md § 2 — that file wins."

### 3.3 Motion tokens (already added in 1.4)

**Prompt:**
> Verify `app/globals.css` includes:
> ```css
> --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
> --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
> --duration-fast: 150ms;
> --duration-base: 200ms;
> --duration-slow: 300ms;
> ```
>
> Create `design-system/motion.md` documenting the rules from `CLAUDE.md § 6` (Motion rules). Keep concise — copy the block verbatim.

### 3.4 Navigation (HAND-WRITE — minimal Payna style)

**Prompt:**
> Build `components/marketing/nav.tsx` matching Payna's nav (very minimal).
>
> **Read first:** CLAUDE.md, design-system/MASTER.md, design-system/motion.md.
>
> **Structure:** server component (waitlist button is its own client wrapper).
> - Fixed top, full-width, `bg-cream` (matches page bg — no border, no shadow until scrolled).
> - Height `h-16`.
> - Inside `<Container>` (flex justify-between items-center):
>   - **Left:** logo lockup. Render `/public/asset/logo.svg` at height 28px via `<Image>` (Next.js Image with `unoptimized` since SVG).
>   - **Right:** `<WaitlistButton>` — primary variant, label `Join Waitlist →`. On click, opens the waitlist modal.
>
> No center nav links. No language switcher. No sign-in. Just logo + CTA.
>
> Add a `"use client"` `<NavScrollShadow />` enhancement: on scroll past 24px, nav background becomes solid with subtle bottom border `border-b border-warm`. `transition: all var(--duration-base) var(--ease-out)`.

### 3.5 Footer (HAND-WRITE — minimal Payna style)

**Prompt:**
> Build `components/marketing/footer.tsx` matching Payna's minimal footer.
>
> - Background: `bg-cream`, top border `border-t border-warm`. Padding `py-16`.
> - Inside `<Container>`, single column structure:
>   1. **Top row** (flex justify-between):
>      - Left: logo (height 28px, same as nav)
>      - Right empty for now
>   2. **Contact + meta row** (mt-10, flex justify-between items-start):
>      - Left column:
>        - Mono eyebrow `text-mono-eyebrow text-ink-muted font-mono`: `> contact`
>        - Email link mt-2: `hello@floventro.com` (// TODO confirm email)
>      - Right column (text-right):
>        - Mono `text-mono-eyebrow text-ink-muted font-mono`: `Lagos, Nigeria · {live timestamp}`
>        - Timestamp is rendered client-side via small `<LiveTime />` client component (updates every second, format like `HH:MM:SS WAT`).
>   3. **Centered CTA** (mt-16): `<WaitlistButton />` again (primary, `Join Waitlist →`).
>   4. **Legal links** (mt-10, centered, `text-mono-eyebrow text-ink-muted`):
>      `Terms of Service · Privacy Policy`
>
> Everything uses Ink Muted color, JetBrains Mono for meta lines, Inter for the email link.

### 3.6 Waitlist modal (`/ui` allowed here only)

**Prompt:**
> Build `components/marketing/waitlist-modal.tsx` (client) and `waitlist-button.tsx` (client).
>
> 1. `waitlist-button.tsx`: thin wrapper that opens a global modal state. Variants:
>    - `primary`: `bg-ink text-cream rounded-md px-5 h-11 text-sm font-medium hover:bg-ink/90 active:scale-[0.98] transition-all var(--duration-fast) var(--ease-out)`
>    - `outline`: `border border-ink/20 text-ink rounded-md px-5 h-11 text-sm font-medium hover:bg-ink/5 active:scale-[0.98]`
> 2. `waitlist-modal.tsx`: built on shadcn `<Dialog>`.
>    - Backdrop: `bg-ink/40 backdrop-blur-sm`. Fade in 200ms.
>    - Modal panel: `bg-cream rounded-xl border border-warm p-8 max-w-md`. Slide up 8px + fade in 250ms ease-out.
>    - Content:
>      - H2 `font-serif text-display-3 text-ink leading-tight`: `Join the waitlist.` (// TODO(copy) can refine)
>      - Body `text-body text-ink-muted mt-2`: // TODO(copy)
>      - Form (mt-6):
>        - Email input: `w-full bg-white border border-warm rounded-md h-11 px-3 text-sm outline-none focus:border-ink/40 transition-colors var(--duration-fast)`
>        - Submit button (mt-3): primary variant, full-width, label `Join Waitlist →`
>      - Loading state: button text replaced by `Adding you…`
>      - Success state: replace form with check icon + text `You're on the list. Check your inbox.` (mono small footnote: `we'll only email about Floventro`)
>      - Error state: small red text below input.
>    - Close button: top-right `×` (real Unicode, not icon component), 24px, `text-ink-muted hover:text-ink`.
> 3. UTMs: capture from `useSearchParams` on first mount, store in sessionStorage, attach to submission.

### 3.7 Screenshot script (Playwright)

**Prompt:**
> Install Playwright and set up the iteration script.
>
> 1. `pnpm add -D playwright`
> 2. `pnpm dlx playwright install chromium`
> 3. Create `scripts/screenshot.ts`:
>    - Connects to `http://localhost:3000`
>    - For each viewport: `desktop` (1440×900), `mobile` (375×812)
>    - For each named section anchor (`#hero`, `#stats`, `#problem`, `#what`, `#where`, `#founders`):
>      - Scroll into view, wait for animations to settle (300ms)
>      - Capture screenshot to `screenshots/{viewport}-{section}.png`
>    - Also capture the full page at each viewport: `screenshots/{viewport}-full.png`
> 4. Add to `package.json`:
>    ```json
>    "scripts": {
>      "screenshot": "tsx scripts/screenshot.ts",
>      "screenshot:section": "tsx scripts/screenshot.ts --section"
>    }
>    ```
> 5. Add `/screenshots/` to `.gitignore`.
>
> Sections need stable `id` attributes — add those when each section is built.

---

## Phase 4 — Landing page sections (Payna-cloned)

> Compose in `app/(marketing)/page.tsx`:
> ```
> <Hero />
> <StatsBand />
> <TheProblem />
> <WhatFloventroDoes />
> <WhereFloventroWorks />
> <FoundingMembersDark />
> ```
>
> **After each section: run `pnpm screenshot` and compare to `model.png`.**

### 4.1 Hero (HAND-WRITE)

**Goal:** Match Payna's hero exactly. Terminal eyebrow → big serif headline with italic → body → CTA → category tags → illustration on right.

**Prompt:**
> Build `components/sections/hero.tsx`.
>
> **Read first:** CLAUDE.md, design-system/MASTER.md, design-system/motion.md, and study `/public/asset/model.png` for layout reference.
>
> **Section:** `id="hero"`, `pt-32 pb-24 md:pt-40 md:pb-32 bg-cream`.
>
> **Inside `<Container>`:** two-column grid `md:grid-cols-[1.4fr_1fr] gap-12 items-start`.
>
> **Left column:**
> 1. Terminal eyebrow block (font-mono, text-mono-eyebrow, text-ink-muted, leading-relaxed):
>    - Line 1: `>Floventro by [TODO company name], Inc.`
>    - Line 2: `>Backed by [TODO investor/program] | [TODO batch]` followed by `<span class="cursor">█</span>`
>    - If no investor yet, replace line 2 with `>Pre-launch · early 2026<span class="cursor">█</span>`
> 2. H1 (`mt-10 font-serif text-display-1 text-ink leading-[1.0] tracking-[-0.02em]`):
>    > // TODO(copy): "We help you move stock," then on a new line, `<em class="italic">everywhere.</em>`
>    Use a `<br/>` between the two lines so the italic word lands on its own line, exactly like Payna.
> 3. Subhead (`mt-8 text-body-lg text-ink-muted max-w-[420px] leading-relaxed`):
>    > // TODO(copy): "The inventory operating system for multi-branch businesses — receiving, distribution, sales, and service tracking across every location."
> 4. CTA row (`mt-10`): `<WaitlistButton variant="primary">Join Waitlist →</WaitlistButton>`
> 5. Category tags (`mt-10 flex flex-wrap gap-2`): each tag is a mono pill, `border border-ink/15 text-ink rounded-md px-3 h-8 text-mono-tag font-mono inline-flex items-center hover:bg-ink hover:text-cream transition-colors var(--duration-fast) var(--ease-out)`:
>    > // TODO(copy) — use industry verticals as placeholders:
>    `Aesthetics · Pharmacies · Salons · Retail · Distributors · Spas · More →`
>    Last item is a link styled the same way that scrolls to `#where`.
>
> **Right column:**
> - The illustration. For V1, generate an SVG: a ring of ~16 small isometric boxes arranged in a circle, similar in spirit to Payna's cube ring. Each box is a simple stroke outline in `text-ink`, no fill, ~24px square, rotated slightly to suggest the ring's curvature. Total composition ~480×480px. Centered vertically against the headline.
> - Mark this as `// TODO(illustration)` — placeholder until real illustration is commissioned.
> - On mobile (`<md`): illustration moves below the text, scaled to 280×280px, centered.
>
> **Motion:**
> - Cursor block: CSS animation only (already set up in globals.css).
> - No entrance animation on the hero — it's instant.
>
> **Acceptance:** Compared side-by-side with model.png, the hero structure matches: eyebrow on top, big serif H1 with italic emphasis word on its own line, subhead under, black CTA, tag row, illustration top-right.

### 4.2 Stats band (HAND-WRITE)

**Prompt:**
> Build `components/sections/stats-band.tsx`.
>
> - Section: `id="stats"`, `py-16 bg-stat-band` (slightly darker cream).
> - Inside `<Container>`, a 3-column grid `md:grid-cols-3 gap-0 divide-x divide-warm`. Each cell is a stat:
>   - Number: `font-serif text-display-2 text-ink leading-none`. Use the same serif typeface but visually-prominent at 56–64px.
>   - Label: `mt-3 text-body-sm text-ink-muted max-w-[200px]`.
> - Three stats // TODO(copy):
>   1. `90%` — `Reduction in stock-out incidents`
>   2. `10×` — `Faster stock reconciliation across branches`
>   3. `4` — `Roles. One real-time source of truth.`
> - On mobile: stack vertically with `divide-y divide-warm divide-x-0`. Each cell `py-8` instead.
> - Numbers are left-aligned in each cell, labels under.
>
> Wrap section header in `<Reveal>` (built in 5.1) so the band fades up on viewport entry.

### 4.3 The Problem (HAND-WRITE)

**Prompt:**
> Build `components/sections/the-problem.tsx`.
>
> - Section: `id="problem"`, `py-32 md:py-40 bg-cream`.
> - Inside `<Container>`:
>   1. Eyebrow (`text-mono-eyebrow text-ink-muted font-mono`): `> the problem`
>   2. H2 (`mt-6 font-serif text-display-2 text-ink max-w-[800px] leading-[1.05] tracking-[-0.02em]`):
>      > // TODO(copy): "You're tracking inventory across branches with spreadsheets and memory."
>   3. Body paragraphs (`mt-10 max-w-[640px] space-y-4 text-body text-ink leading-[1.7]`):
>      > // TODO(copy): 3 short paragraphs about the pain — stock drift between branches, vendor balances slipping, no clear chain from receipt to sale, inventory teams emailing sales teams for updates, etc.
>
> Wrap H2 and the first paragraph in `<Reveal>` separately so they cascade in.

### 4.4 What Floventro Does — numbered 01–05 list (HAND-WRITE)

**Prompt:**
> Build `components/sections/what-floventro-does.tsx`.
>
> - Section: `id="what"`, `py-32 md:py-40 bg-cream`.
> - Inside `<Container>`:
>   1. Eyebrow: `> what floventro does` (mono).
>   2. Numbered list (mt-16). Each item is a row, separated by `border-t border-warm`, with `py-10` per row. Last item has `border-b border-warm`.
>   3. Each row uses grid `md:grid-cols-[80px_1fr_3fr] gap-8 items-start`:
>      - **Column 1 — number:** `font-mono text-mono-eyebrow text-ink-muted` showing `01`, `02`, etc.
>      - **Column 2 — heading:** `font-sans text-body-lg font-medium text-ink leading-snug` // TODO(copy) — short bold title (4-7 words)
>      - **Column 3 — body:** `text-body text-ink-muted leading-relaxed` // TODO(copy) — 2-3 sentence explanation
> - On mobile: single column. Number above heading, heading above body, with `mt-2` between each.
>
> **5 numbered items** (// TODO(copy) — pull from Floventro spec doc, condense):
> - `01` — **Tracks every product, from delivery to consumption.** Body about vendor invoice → inventory → request → fulfillment → sale or service.
> - `02` — **Runs every branch as its own workspace.** Body about per-branch catalogues, vendors, teams.
> - `03` — **Approves internal requests cleanly.** Body about Sales/Internal Use requesting from Inventory, partial approval, audit trail.
> - `04` — **Moves stock between branches like a vendor invoice.** Body about inter-branch transfers using the same mental model as receiving stock.
> - `05` — **Gives owners the full picture, in real time.** Body about cross-branch dashboard, drill-down per branch.
>
> Wrap each row in `<Reveal>` with `delay={i * 0.06}` for stagger.

### 4.5 Where Floventro Works (HAND-WRITE)

**Goal:** Centered big headline + config-style panel listing industries.

**Prompt:**
> Build `components/sections/where-floventro-works.tsx`.
>
> - Section: `id="where"`, `py-32 md:py-40 bg-cream`.
> - Inside `<Container>`:
>   1. Centered eyebrow (`text-mono-eyebrow text-ink-muted font-mono`): `> where floventro works`
>   2. H2 (centered, mt-6, `font-serif text-display-2 text-ink leading-[1.05] tracking-[-0.02em]`):
>      > // TODO(copy): Two-line headline with italic emphasis:
>      > Line 1: `For multi-branch businesses.`
>      > Line 2: `<em class="italic">In any industry.</em>`
>   3. Config-style panel (`mt-20 max-w-[1000px] mx-auto bg-cream border border-warm rounded-lg p-8 md:p-12`):
>      - Two stacked blocks separated by `mt-10`:
>      - **Block 1:**
>        - Mono label: `INDUSTRIES`
>        - mt-3: flex-wrap row of industry names in mono, separated by single spaces (just `gap-x-4 gap-y-2 flex flex-wrap`). Each item is text only, no border:
>          // TODO(copy):
>          `Aesthetics  Pharmacies  Salons  Retail Chains  Distributors  Spas  Optical Stores  Pet Stores  Vet Clinics  Hardware  Auto Parts  Cosmetics  Wellness  Fashion  More...`
>      - **Block 2:**
>        - Mono label: `ROLES SUPPORTED`
>        - mt-3: same pattern. Items: `Owner  Inventory  Sales  Internal Use`
>      - **Block 3:**
>        - Mono label: `WHAT WE TRACK`
>        - mt-3: `Vendor invoices  Stock movement  Internal requests  Sales  Service usage  Transfers  Customer history  Client history  Balances`
>
> Wrap H2 and the panel in `<Reveal>` (separately).

### 4.6 Founding Members (dark closing — HAND-WRITE)

**Goal:** Payna's "For Firms" black section, adapted to founding-members pitch.

**Prompt:**
> Build `components/sections/founding-members-dark.tsx`.
>
> - Section: `id="founders"`, `py-32 md:py-40 bg-black-deep text-cream`.
> - Inside `<Container>`, two-column grid `md:grid-cols-[1.4fr_1fr] gap-12 items-center`.
>
> **Left column:**
> 1. Eyebrow (`font-mono text-mono-eyebrow text-cream/60`): `> founding members`
> 2. H2 (`mt-6 font-serif text-display-2 text-cream leading-[1.05] tracking-[-0.02em]`):
>    > // TODO(copy): "Be among the first 100." then on a new line, `<em class="italic">Help shape what Floventro becomes.</em>`
> 3. Body paragraphs (`mt-10 max-w-[520px] space-y-4 text-body text-cream/70 leading-[1.7]`):
>    > // TODO(copy): One paragraph about the founding cohort's perks (lifetime 50% off, direct line to the team, first access). One paragraph about why we're doing this (we want partners, not just users).
> 4. CTA (`mt-10`): `<WaitlistButton variant="primary">Join Waitlist →</WaitlistButton>` — but invert the colors for this dark section. Add a variant `primary-on-dark`: `bg-cream text-ink rounded-md px-5 h-11 text-sm font-medium hover:bg-white active:scale-[0.98]`.
>
> **Right column:**
> - The same SVG illustration as the hero, but with stroke color set to `text-cream/30` (outlined faintly on the black background). Centered.
> - On mobile: illustration moves below text, scaled to 240×240px, centered.

---

## Phase 5 — Polish

### 5.1 Section reveals (emil-design-eng)

**Prompt:**
> Create `components/ui/reveal.tsx` (client):
> - Wraps children. Uses Framer Motion `whileInView`.
> - `initial: { opacity: 0, y: 12 }`, `whileInView: { opacity: 1, y: 0 }`.
> - `viewport={{ once: true, margin: '-10%' }}`.
> - `transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}` (our --ease-out as Bezier array).
> - Respects `prefers-reduced-motion` via `useReducedMotion()` — skip animation if reduced.
> - Optional `delay` prop.
>
> Apply `<Reveal>` to:
> - Stats band (one wrap around the whole band)
> - The Problem H2 and lede paragraph (separately)
> - Each `01–05` row in What Floventro Does (with `delay={i * 0.06}`)
> - Where Floventro Works H2 and config panel (separately)
> - Founding Members H2 and body block (separately)
>
> Do NOT wrap the hero — it's instant.
> Do NOT wrap individual paragraphs in The Problem or Founding Members body — too much animation.

### 5.2 Motion audit

**Prompt:**
> Verify against `design-system/motion.md`:
>
> 1. `grep -rn 'ease-in[^-]' app/ components/` → must return nothing.
> 2. `grep -rn 'transition:.*\(width\|height\|top\|left\|margin\|padding\)' app/ components/` → must return nothing animated.
> 3. Confirm `prefers-reduced-motion` is respected in `<Reveal>` and the cursor blink (CSS via `@media (prefers-reduced-motion: reduce)`).
> 4. Modal animations: backdrop 200ms fade, panel 250ms slide+fade.
> 5. All button hovers: 150ms.
>
> Report findings as a checklist; fix any failures.

### 5.3 SEO, OG image, sitemap, robots, analytics

**Prompt:**
> 1. Create `public/asset/og-image.png` — 1200×630 with Floventro wordmark on cream. If unable to generate, leave `og-image.png.placeholder.txt` with the spec.
> 2. `app/robots.ts` — allow all, point to sitemap.
> 3. `app/sitemap.ts` — home page only.
> 4. Install `@vercel/analytics`, mount `<Analytics />` in root layout.
> 5. Track `waitlist_signup` event on successful modal submission.
> 6. UTM capture on page load → sessionStorage → attached to form payload.

### 5.4 Full-page screenshot review

**Prompt:**
> Run `pnpm screenshot` to capture every section at desktop + mobile.
> Compare each output to `/public/asset/model.png` at the equivalent region.
> Produce a markdown report `screenshots/REVIEW.md` listing:
> - Sections matching ≥90% structurally → mark `✓`
> - Sections with structural deltas → list specific items (e.g. "hero italic emphasis word is too small", "numbered list row padding is too tight")
> - Stop here and wait for me to triage before fixing.

---

## Phase 6 — Ship

### 6.1 Vercel deploy

**Prompt:**
> 1. `pnpm build` locally — zero errors.
> 2. Create `docs/deploy.md`: link repo to Vercel, set env vars, configure custom domain `floventro.com` + `www.floventro.com`, DNS, ZeptoMail SPF + DKIM.
> 3. First deploy. Verify production serves correctly.

---

## Daily rhythm

| Day | Tasks |
|-----|-------|
| 1   | 1.3 → 1.4 (rebuild tokens) → 2.1 → 2.2 → 2.3 |
| 2   | 3.1, 3.2, 3.3, 3.4 (nav), 3.5 (footer), 3.6 (modal), 3.7 (screenshot setup) |
| 3   | 4.1 (hero — biggest) → screenshot review → iterate |
| 4   | 4.2, 4.3 → screenshot review → iterate |
| 5   | 4.4, 4.5 → screenshot review → iterate |
| 6   | 4.6 → 5.1, 5.2 → full screenshot pass |
| 7   | 5.3, 5.4 → 6.1 |

---

## What's deferred

- Real illustration (commissioned)
- Real waitlist counter
- Referral codes / share-to-skip
- Pricing page
- Blog
