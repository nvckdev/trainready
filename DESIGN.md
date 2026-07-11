# TrainReady Design System

Light precision instrument. Warm paper, engraved ink, one signal color. Every visual is data made visible: topographic lines, elevation profiles, splits, tick marks. The site should feel like a beautifully printed instrument manual that turned out to be alive.

## Theme

Light only. No dark mode, no theme toggle. The paper IS the identity. Scene: an athlete at a desk lamp after an evening session, reviewing the week like a surveyor reviews a field book.

## Color

Strategy: **Committed** — ink-on-paper monochrome foundation; flight-recorder orange carries the "live / measured / recording" layer (CTAs, data strokes, live readouts, the route line). Orange marks what records, never what merely wants attention.

- `--paper`: oklch(0.965 0.008 84) — warm paper base
- `--paper-raised`: oklch(0.985 0.004 84) — cards, panels
- `--paper-sunken`: oklch(0.94 0.01 84) — inset wells, table stripes
- `--ink`: oklch(0.225 0.012 60) — primary text, drawn lines
- `--ink-muted`: oklch(0.46 0.012 60) — secondary text
- `--ink-faint`: oklch(0.62 0.01 70) — tertiary, tick labels
- `--hairline`: oklch(0.865 0.01 84) — rules, borders (1px only)
- `--signal`: oklch(0.645 0.205 38) — flight-recorder orange (≈ #ff4f00)
- `--signal-ink`: oklch(0.53 0.185 38) — orange dark enough for small text on paper
- Never #000 or #fff. Orange never used for paragraphs. AA contrast on all text.

## Typography

- **Display / headings**: Archivo (variable, wght 100–900 × wdth 62–125). Headlines set Black (wght 800–900) at expanded width (wdth 110–125), uppercase, tracking -0.01em, like machined engraving. Sub-heads at normal width, 600–700.
- **Body**: Archivo 400–500, normal width, max 68ch.
- **Telemetry / labels / captions**: Fragment Mono 400. All figures, units, coordinates, axis labels, nav items, and button labels are mono. Tabular numerals everywhere numbers tick.
- Scale: fluid clamp(), ratio ≥1.333 between steps. Hero display up to clamp(4rem, 12vw, 11rem).

## Texture & Surface

- Hairline rules (1px `--hairline`) as the structural grammar: full-bleed horizontal rules between sections, ruled margins, crop marks, register ticks. The page reads as a technical sheet.
- Fine tick-mark strips (like a ruler edge) as section punctuation.
- No shadows except a single, tight, low-opacity ink shadow on truly raised elements. No glassmorphism, no gradients-as-decoration, no grain.

## Motion

- Library: GSAP 3 (ScrollTrigger, SplitText, DrawSVG-style line drawing) + Lenis smooth scroll + three.js (@react-three/fiber) for the topographic terrain.
- Grammar: **drafting, not fading**. SVG paths draw themselves (stroke-dashoffset), numbers tick up in mono, type sets line-by-line with SplitText, rules extend from 0 to full width. Never generic opacity+translateY fade-ups.
- Easing: ease-out quart/quint/expo. Durations 0.6–1.2s for reveals; scroll-scrubbed for pinned scenes. No bounce, no elastic.
- Signature scene: ink-wireframe 3D terrain (paper-colored fog, ink contour lines, orange route line) scrubbed by scroll — a living topographic map, in daylight. WebGL on paper, not on black.
- `prefers-reduced-motion`: everything renders in final composed state; canvas shows a static frame; no pinning.

## Components

- **Buttons**: rectangular, 2px radius max. Primary = ink fill, paper text, mono label, uppercase. Signal variant = orange fill for the single primary CTA per viewport. Hover: instant (≤150ms) — a recorded state change, not a soft glow.
- **Nav**: hairline-ruled top strip, mono labels, current-time / coordinates readout as instrument dressing.
- **Data displays**: spec-sheet tables with hairline rules, not cards. Figures in Fragment Mono with units in `--ink-faint`.
- **Diagrams over icons**: elevation profiles, pace curves, stroke diagrams drawn as SVG line art in ink + orange. Lucide icons only for pure utility (menu, arrow).

## Layout

- 12-col grid with visible discipline; generous asymmetry inside a strict frame. Ruled left margin on long sections (like a field book).
- Section spacing varies deliberately: clamp(6rem, 14vh, 12rem) between major movements, tight inside groupings.
- One idea per fold. Full-bleed moments (terrain, hero type) alternate with margin-ruled documentation passages.
