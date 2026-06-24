# Floventro Motion System

Distilled from emil-design-eng for this project's personality:
professional B2B inventory tool. Crisp and fast over playful.

## Easing tokens (in globals.css)
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);       /* default for UI */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);   /* on-screen movement */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);    /* if drawer needed */

## Duration tokens
--duration-fast: 150ms;   /* hover, color, micro */
--duration-base: 200ms;   /* most UI: button press release, popovers */
--duration-slow: 300ms;   /* section reveals, dialog enter */

## Rules
- Never use `ease-in` for UI motion.
- UI animations stay ≤ 300ms. If longer, justify in comment.
- Animate `transform` and `opacity` only. Never `width`, `height`,
  `top`, `left`, `margin`, `padding` — they trigger layout/paint.
- Enter from `scale(0.96)` and `translateY(8px)`, not `scale(0)`.
- Section reveals: opacity 0→1 + translateY 16px→0, 400ms, ease-out,
  trigger once on viewport entry.
- Stagger reveals: 60ms between siblings, max 4 items staggered.
- Logo / industry marquee: linear, 40s loop, pause on hover.
- Hover state: 150ms ease. Active/press: 100ms ease-out.
- Respect `prefers-reduced-motion` — skip all decorative motion.

## Framer Motion reference values

```ts
// Section reveal (Reveal component)
initial: { opacity: 0, y: 16 }
animate: { opacity: 1, y: 0 }
transition: { duration: 0.4, ease: [0.23, 1, 0.32, 1] }
viewport: { once: true, margin: '-10%' }

// Dialog / popover enter
initial: { opacity: 0, scale: 0.96 }
animate: { opacity: 1, scale: 1 }
transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] }

// Role picker content swap (AnimatePresence mode="wait")
exit:   { opacity: 0, y: -8, transition: { duration: 0.15 } }
enter:  { opacity: 0, y: 8 }
animate:{ opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } }

// Stagger children
delay: index * 0.06   // max 4 items → max 240ms total stagger
```

## CSS animation reference

```css
/* Marquee — pure CSS, no JS */
@keyframes marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}

.marquee-track {
  animation: marquee 40s linear infinite;
}
.marquee-track:hover {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  .marquee-track { animation: none; }
}
```

## What NOT to animate

| Property | Why |
|----------|-----|
| `width` / `height` | Triggers layout — use `transform: scaleX/Y` instead |
| `top` / `left` | Triggers layout — use `transform: translate` instead |
| `margin` / `padding` | Triggers layout |
| `border-width` | Triggers layout — use `box-shadow` or `outline` instead |
| `font-size` | Triggers layout — acceptable on hover only if no reflow |
| `background-color` alone at > 300ms | Feels sluggish; keep to 150ms |
