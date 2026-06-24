# Design System Master File

> **Brand tokens locked in CLAUDE.md § 2 — that file wins on any color/font conflict.**
>
> When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Floventro  
**Generated:** 2026-06-21  
**Category:** Enterprise B2B SaaS — Multi-branch inventory & distribution  

---

## Pattern

**Name:** Enterprise Gateway (adapted from UI UX Pro Max — Trust & Authority pattern)

- **Conversion Focus:** Role-based path selection ("Which role are you?"), trust signals prominent, early social proof, waitlist CTA above fold
- **CTA Placement:** Primary CTA above fold in hero; secondary CTA repeated at bottom
- **Color Strategy:** Violet primary for trust/authority; Coral for CTAs and accents; Obsidian for text weight
- **Section Order:** Hero (role picker) > Trust Badge > Industry Marquee > What It Does > Speed/Process > Platform Tiles > Why Floventro > Founding Members > FAQ > Final CTA

---

## Global Rules

### Color Palette

> **LOCKED** — these are the only permitted colors. Any tool-generated color that isn't listed here must be replaced before committing.

| Role | Token | Hex | CSS Variable |
|------|-------|-----|--------------|
| Primary / Brand | Cobalt Violet | `#6200EE` | `var(--violet)` |
| Accent / CTA | Electric Coral | `#FF5A36` | `var(--coral)` |
| Text / Dark backgrounds | Charcoal Obsidian | `#121824` | `var(--obsidian)` |
| Page background | Crisp Alabaster | `#F8FAFC` | `var(--alabaster)` |
| Surface / Cards | Pure White | `#FFFFFF` | `white` |

**Usage rules:**
- Violet: primary buttons, active states, links, brand accents, eyebrow labels
- Coral: secondary/accent buttons, CTA highlights, icon accents, check marks in lists
- Obsidian: body text, headings, dark section backgrounds
- Alabaster: page background, section alternation, input backgrounds
- White: cards, nav, surfaces that need lift above alabaster

**No other hex values permitted.** Opacity variants (`/70`, `/10`, etc.) are allowed — e.g. `text-obsidian/70`, `bg-violet/10`.

### Typography

> **LOCKED** — only these two font families.

| Role | Font | Variable |
|------|------|----------|
| Display / Headings | Clash Display | `var(--font-clash)` → Tailwind: `font-display` |
| Body / UI | Inter | `var(--font-inter)` → Tailwind: `font-sans` |

- **Clash Display** via Fontshare CDN. Use for H1, H2, H3, eyebrow labels, card titles, nav wordmark.
- **Inter** via `next/font/google`. Use for body copy, captions, form labels, nav links, button text.
- No other fonts. No Google Fonts suggestions from external tools unless they are these two.

**Mood:** Professional, modern, B2B — "friendly authority." Confident without being corporate-cold.

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px / 0.25rem` | Tight gaps |
| `--space-sm` | `8px / 0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px / 1rem` | Standard padding |
| `--space-lg` | `24px / 1.5rem` | Section padding |
| `--space-xl` | `32px / 2rem` | Large gaps |
| `--space-2xl` | `48px / 3rem` | Section margins |
| `--space-3xl` | `64px / 4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(18,24,36,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(18,24,36,0.08)` | Cards, inputs |
| `--shadow-lg` | `0 10px 15px rgba(18,24,36,0.08)` | Dropdowns, raised cards |
| `--shadow-xl` | `0 20px 25px rgba(98,0,238,0.10)` | Hero images, featured cards (violet-tinted) |

---

## Style Guidelines

**Style:** Trust & Authority — adapted for pre-launch SaaS  
**Keywords:** Role differentiation, expert positioning, operational clarity, process transparency, social proof through specificity  
**Best For:** B2B enterprise tools, multi-stakeholder SaaS, operations-focused products  

**Key Effects** (from UI UX Pro Max — keep as-is):
- Smooth stat reveal on scroll entry
- Subtle badge/pill hover effects
- Role-picker content crossfade (AnimatePresence)
- Metric/number emphasis on hover (scale up slightly)

---

## Component Specs

### Buttons

```css
/* Primary — Cobalt Violet */
.btn-primary {
  background: var(--violet);       /* #6200EE */
  color: white;
  padding: 12px 24px;
  border-radius: 9999px;           /* rounded-full — Floventro convention */
  font-weight: 500;
  height: 44px;
  transition: all 200ms cubic-bezier(0.23, 1, 0.32, 1);
  cursor: pointer;
}
.btn-primary:hover { background: color-mix(in srgb, var(--violet) 90%, transparent); }
.btn-primary:active { transform: scale(0.98); }

/* Accent — Electric Coral */
.btn-coral {
  background: var(--coral);        /* #FF5A36 */
  color: white;
  padding: 12px 24px;
  border-radius: 9999px;
  font-weight: 500;
  height: 44px;
  transition: all 200ms cubic-bezier(0.23, 1, 0.32, 1);
  cursor: pointer;
}
.btn-coral:hover { background: color-mix(in srgb, var(--coral) 90%, transparent); }
.btn-coral:active { transform: scale(0.98); }

/* Ghost */
.btn-ghost {
  background: transparent;
  color: var(--obsidian);
  border-radius: 9999px;
  transition: all 200ms cubic-bezier(0.23, 1, 0.32, 1);
  cursor: pointer;
}
.btn-ghost:hover { background: color-mix(in srgb, var(--obsidian) 5%, transparent); }
```

### Cards

```css
.card {
  background: white;
  border-radius: 16px;             /* rounded-2xl */
  padding: 32px;
  border: 1px solid color-mix(in srgb, var(--obsidian) 5%, transparent);
  transition: all 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--obsidian) 15%, transparent);
  border-radius: 12px;
  font-size: 16px;
  background: white;
  transition: border-color 150ms cubic-bezier(0.23, 1, 0.32, 1);
}
.input:focus {
  border-color: var(--violet);
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--violet) 15%, transparent);
}
```

---

## Anti-Patterns (Do NOT Use)

From UI UX Pro Max (kept verbatim — industry-appropriate findings):

- ❌ **Playful design** — This is operational software; avoid rounded mascots, confetti, bouncy animations
- ❌ **Hidden credentials** — Trust signals (security, reliability claims) must be visible, not buried
- ❌ **AI purple/pink gradients** — We use a specific Cobalt Violet; no rainbow/aurora/mesh gradients

Additional Floventro-specific:

- ❌ **Any hex color not in the palette above** — Replace immediately when tools generate them
- ❌ **Plus Jakarta Sans, Inter Tight, or any other font** — Only Clash Display + Inter
- ❌ **`ease-in` on any UI motion** — Use `ease-out` or `ease-in-out` only
- ❌ **Animating `width`, `height`, `top`, `left`, `margin`, `padding`** — Triggers layout/paint; use `transform` + `opacity` only
- ❌ **Animations longer than 300ms** (except marquees and section reveals — max 400ms)
- ❌ **Gradients** — Only the final CTA section uses a subtle violet radial gradient; nowhere else
- ❌ **Emoji as icons** — Lucide outline icons only
- ❌ **Filled Lucide variants** — Outline only across the entire codebase

---

## Pre-Delivery Checklist

Before shipping any section:

- [ ] All colors are from the locked palette above (or opacity variants)
- [ ] All fonts are Clash Display (display) or Inter (body) — no others
- [ ] All icons are Lucide outline — no filled, no emoji
- [ ] `cursor-pointer` on all interactive elements
- [ ] Hover states transition ≤ 150ms (fast) or 200ms (base)
- [ ] Active/press states: `scale(0.98)` on buttons
- [ ] `prefers-reduced-motion` respected — decorative animations skip
- [ ] No `ease-in` anywhere in the codebase
- [ ] Only `transform` and `opacity` animated — never layout properties
- [ ] Focus states visible for keyboard navigation (violet ring)
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No horizontal scroll on mobile
- [ ] No content hidden behind fixed nav (use `pt-16` or anchor offset)
