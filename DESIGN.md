# Taper Design System — Night Instrument

The light field manual (branch `concept/light-instrument`) inverted for race-week nights: warm ember-black field, bone-cream engraving, one signal color. Everything still reads as a precision instrument; now it's read by lamplight.

## Theme

Dark only. Scene: an age-grouper checking tomorrow's session at 21:40 after the house has gone quiet; the screen is the only light in the room. Calm, warm dark: never blue-black, never neon.

## Color

Strategy: **Committed** — cream-on-ember monochrome foundation; flight-recorder orange carries the "live / adaptive / recording" layer (route line, readiness, CTAs, race day drench). Orange marks what changes, never what merely decorates.

- `--field`: oklch(0.17 0.009 60) — warm near-black page ground
- `--field-raised`: oklch(0.21 0.01 60) — panels, cards
- `--field-sunken`: oklch(0.145 0.008 60) — wells, hover beds
- `--bone`: oklch(0.94 0.012 84) — primary text, drawn lines (the old paper, now the ink)
- `--bone-muted`: oklch(0.72 0.012 80) — secondary text
- `--bone-faint`: oklch(0.55 0.01 75) — tertiary, tick labels
- `--hairline`: oklch(0.32 0.012 65) — rules, borders (1px only)
- `--signal`: oklch(0.66 0.2 40) — flight-recorder orange (fills, large type)
- `--signal-text`: oklch(0.74 0.16 45) — brightened signal safe for small text on the field
- No pure #000/#fff. Orange never used for paragraphs.

## Typography

Unchanged from the light concept (continuity across editions):
- **Display:** Archivo variable, wght 820–900 × wdth 115–125, uppercase, tracking −0.015em (`.display-engraved`).
- **Body:** Archivo 400–500, max 68ch.
- **Telemetry:** Fragment Mono 400 for every figure, unit, label, nav item, button (`.label-mono`), tabular numerals.
- Light-on-dark: body line-height +0.05 vs. light edition.

## Texture & Surface

- Hairline-rule grammar, ruler tick strips, crop marks: unchanged, rendered in bone/hairline tones.
- The **taper mark**: a rule that narrows to a point and ends in a signal dot (the season converging on race day). Used as brand underline and favicon; the one new motif of the night edition.
- Shadows barely exist on dark; raised panels separate by `--field-raised` + hairline instead. No glassmorphism, no glow auras (the rec-dot's pulse is opacity, not bloom).

## Motion

Same drafting grammar as the light edition: GSAP + ScrollTrigger + SplitText + DrawSVG + Lenis; lines draw, counters tick, rules extend, type sets line-by-line behind masks. Ease-out quart/quint/expo, 0.6–1.2 s reveals, scroll-scrubbed pinned scenes. Signature scene: the night terrain: ember ground, bone contour lines, signal route drawing across it. Full `prefers-reduced-motion` static fallback.

## Components

- **Buttons:** rectangular, radius 2px. Primary = signal fill, field-dark text. Secondary = hairline border, bone text. Mono uppercase labels. Hover = instant state change (≤150 ms), no glow.
- **Nav:** hairline-ruled strip on `--field`, mono labels, live UTC clock, "Join the beta" CTA.
- **Panels:** `--field-raised` + hairline border + crop marks for manual-plate framing.
- **Data:** spec-sheet tables, drawn SVG diagrams in bone with signal data lines. Diagrams over icons, always.

## Layout

12-col grid, ruled margins, generous asymmetry inside a strict frame. Section spacing clamp(6rem, 14vh, 11rem). Full-bleed dark scenes alternate with margin-ruled documentation passages. One idea per fold.
