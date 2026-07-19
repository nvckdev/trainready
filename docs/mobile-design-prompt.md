# Claude Design prompt — Taper mobile UI

Copy everything below the rule into Claude Design as one prompt.

---

Design a native mobile app UI (iOS-first, 393×852 baseline, Android-compatible) for **Taper**, an evidence-honest endurance-training engine. This is a redesign pass: a working v0.1 exists and the information architecture is fixed; your job is to make it beautiful, hierarchical, and unmistakably Taper — not to invent new features or new branding.

## The brand: "Night Instrument" (non-negotiable)

Taper's design system is a precision instrument read by lamplight: an age-grouper checking tomorrow's session at 21:40 after the house has gone quiet. Calm, warm, dark, exact. Never neon, never gamer-cockpit, never AI-glow.

**Color (dark only — there is no light mode):**
- `field` #241f1a — warm ember-black page ground (oklch 0.17 0.009 60)
- `field-raised` #2e2822 — panels
- `field-sunken` #1c1814 — wells, input beds, track backgrounds
- `bone` #f0ead9 — primary text and drawn lines (oklch 0.94 0.012 84)
- `bone-muted` #b3a996 — secondary text
- `bone-faint` #847b69 — tertiary, tick labels
- `hairline` #4a4136 — rules and borders, 1px only, ever
- `signal` #f0521a — flight-recorder orange (fills, large marks)
- `signal-text` #ff7a3d — brightened signal safe for small text on the field

Color strategy is **Committed**: cream-on-ember monochrome foundation; orange carries the "live / adaptive / recording / counting down" layer only. Orange marks the active tab, the current week, race day, the CTA, the recording dot. Orange is never decoration, never body text, never a gradient.

**Typography:**
- Display: **Archivo** ExtraBold/Black, UPPERCASE, tight tracking (−0.015em), used big and confidently. Wide-width cuts welcome.
- Telemetry: **Fragment Mono** for every figure, unit, label, nav item, and button — tabular numerals, letterspaced uppercase micro-labels (11px, +1.2 tracking).
- Body: Archivo Regular/Medium, max ~68ch, generous line-height on dark (+0.05).

**Motifs:**
- Hairline-rule grammar: sections separated by 1px rules, spec-sheet tables, ruler tick strips.
- The **taper mark**: a horizontal rule that narrows to a point and ends in a signal dot (the season converging on race day). Use it as a brand moment, e.g. under a screen title or as the plan timeline's spine.
- The **rec-dot**: a small pulsing signal dot next to the wordmark; pulse is opacity only, no bloom.
- Buttons: rectangular, radius ≤2px. Primary = signal fill with field-dark text; secondary = hairline border, bone text. Mono uppercase labels. Instant hover/press states, no glow.

**Hard bans:** glassmorphism, blur cards, neon glows, gradient orbs, gradient text, side-stripe accent borders, big rounded icon tiles, black-and-red gamer aesthetics, bouncing/elastic motion, pure #000 or #fff, light mode. Motion is drafting-table: lines draw, counters tick, exponential ease-out, 0.6–1.2s, full reduced-motion fallback.

**Voice for any copy you write:** quietly confident, insider-warm, technically exact ("trust the taper"). Honesty is the product: never write "research shows" or "guaranteed"; hedged claims stay hedged ("we think", "observational", "projected"). No em dashes.

## The product in one paragraph

Taper generates a periodized season plan on-device from a race goal and the athlete's training state, then adapts it. Its differentiators — which the UI must make felt, not just legible — are: (1) every prescriptive claim carries an evidence tier (randomised trial / observational / elite practice / our best guess); (2) the goal check tells athletes **no** when a goal isn't reachable and names the honest projected finish; (3) injuries cap only what they provoke, with a plain-language why; (4) intensity distribution (easy/moderate/hard time) is a first-class, visible constraint.

## Screens to design (IA is fixed: 4 bottom tabs)

Design each screen with the REAL content below (no lorem). Bottom tab bar: TODAY · PLAN · FITNESS · GOAL, mono uppercase labels, active tab in signal with a tiny dot.

**1. Today** — the daily read. Content: wordmark + rec-dot + a "DEMO DATA" flag when sample data is active; projected fitness chips (Fitness 28 CTL · Form 13 TSB · Week 3/16 Base); a week brief line ("Target 220 TSS. 2/5 sessions done."); today's session as the hero card — title "Tempo intervals", 43 min · 46 TSS · run, structure text ("WARMUP 10 min easy… MAIN 2×8 min @ 4:45/km…"), a one-line why ("Race-specific fitness only sticks on top of an aerobic base."), and a Mark done control; then up to 3 upcoming sessions, smaller. Rest-day state: "Nothing scheduled today. The easy days are doing real work." Footer micro-label: "Plans are generated on this device · not medical advice."

**2. Plan** — the season. Content: race header ("A RACE", 2026-11-07 · run-half · engine taper-v1); stat chips (CTL at plan start 28 · Race-day CTL 28 proj. · Race-day form 13 TSB); a Goal check panel ("1:45:00 → realistic finish ~1:45 (load-limited)" plus a 2-sentence honest message); a Volume targets panel labeled "evidence: observational" (peak weekly 61 km vs floor 32; longest run 19 km vs floor 21 — design the below-floor state honestly, not as an error); an optional Tissue constraint panel in signal ("Calf: pain on foot rotation…"); then 16 week rows — each row: week start, phase (Base/Build/Cutback/Taper/Race), a TSS bar, the number; the current week expanded showing a time-in-zone strip (93% easy · 7% mod · 1% hard) and its 5 sessions. Make the season's shape readable at a glance: base rising, cutbacks dipping, taper narrowing into the race — this is where the taper mark motif belongs.

**3. Fitness** — the trajectory. Content: projected CTL curve across the plan (28 → 30), bone line on ember with a signal dot on race morning, mono axis ticks; per-week CTL/TSB list; an honest caption: "Projections from the generated plan, not measurements."

**4. Goal** — the intake form. Content: race name; race date; distance chips (5K/10K/Half/Marathon); run days per week (4–7); long-run day (Sat/Sun); optional goal time with the caption "If the goal is out of reach, the plan says so and projects the honest finish."; primary CTA "GENERATE THE PLAN"; inline validation error state ("Pick a race at least 3 weeks out — a taper needs runway."). Design a plan-generation moment: a brief drafting animation (rules extending, counters ticking) while the engine runs — this is the product's one theatrical beat.

## What v0.1 gets wrong (your improvement targets)

- **Bordered-box monotony**: every element is a 1px-bordered panel; there's no rhythm. Vary the grammar — full-bleed passages, rules instead of boxes, tighter groupings, one hero element per screen.
- **Flat hierarchy**: stat chips, session cards, and panels all shout equally. Each screen needs one dominant read (Today = today's session; Plan = the season's shape; Fitness = the curve; Goal = the CTA).
- **Underused data-vis**: the distribution strip and TSS bars are minimal. Make measurement the ornament — contour-style curves, tick strips, drawn SVG — without becoming a dashboard wall.
- **Evidence tiers are plain text**: design a small, reusable evidence-tier tag (e.g. "OBSERVATIONAL") that reads as an instrument stamp, tappable to reveal the plain claim + source.
- **No signature moments**: add the taper mark, the generation animation, a satisfying mark-done tick. Keep them quiet.

## Ergonomics and accessibility

44pt minimum touch targets; primary actions in thumb reach; safe-area aware (home indicator, notch); WCAG AA on the dark field (bone on field passes; signal only for large text or with signal-text for small); meaning never by color alone (pair signal states with a label or mark); dynamic-type tolerant layouts; full reduced-motion fallback (static composed layout).

## Deliverables

All four tab screens at 393×852, plus: Today rest-day state, Plan empty state ("No active plan"), Goal error state, the plan-generation loading moment, and the expanded vs collapsed week row. Show the tab bar on every screen. Include a one-screen component sheet: stat chip, session card, evidence tag, week row, distribution strip, buttons, form fields.
