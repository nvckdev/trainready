# Taper — Product Requirements Document

**Version:** 0.1 · July 2026
**Status:** Draft for validation
**Owner:** Nick

---

## 1. Overview

**One-liner:** Taper builds and continuously adapts a personalized endurance training plan from your race goal, your training history, and your experience, so you arrive at the start line at your peak.

**Vision:** Every self-coached endurance athlete trains with a plan that a world-class coach would sign off on: periodized toward their race, calibrated to their physiology, adjusted every day to their actual life, and explained in plain language. The whole season bends toward one moment; the product is named for it.

**Why now:**

- The AI-coach category is validated (TriDot, Athletica, Humango, Transition) but every leader has a conspicuous weakness: dated interfaces, black-box prescriptions, rigid adaptation, or shallow analytics.
- Founder advantage: multiple years of real triathlon training and racing data (TrainingPeaks) to seed model development and backtesting, plus a proprietary training-advice algorithm covering swim, bike, and run for any athlete level.
- Device and platform APIs (Garmin, Strava, TrainingPeaks, COROS) make full-fidelity history import and structured-workout push practical for a small team.

---

## 2. Problem

Self-coached athletes assemble their training from static PDF plans, forum folklore, and generic app suggestions. The result:

1. **Plans don't fit.** Static plans ignore training history, experience, and available hours; athletes start too hard or too easy.
2. **Plans don't adapt.** Life happens: missed sessions, illness, travel, fatigue. Re-planning by hand is guesswork, so athletes either overreach or lose fitness.
3. **Numbers without narrative.** Platforms like TrainingPeaks surface CTL/ATL/TSB but prescribe nothing; athletes see the data and still don't know what to do tomorrow.
4. **Coaching is expensive.** A human tri coach runs $150–400+/month; the athletes who need guidance most can't justify it.

---

## 3. Target users

**P1 — The committed age-grouper (primary).** 28–55, training 6–12 h/week for 70.3/Ironman/marathon/gran fondo. Owns a GPS watch and probably a power meter. Has TrainingPeaks or Strava history. Wants a coach-quality plan without the coach price. Success = a finish-time goal.

**P2 — The first-timer with a date.** Signed up for a first sprint/Olympic tri or half marathon. Intimidated, needs structure and confidence more than optimization. Success = arriving at the start healthy and finishing.

**P3 — The single-sport specialist.** Runner or cyclist who wants adaptive planning without triathlon framing. Served by the same engine with one discipline enabled; a deliberate audience expansion, not a separate product.

---

## 4. Competitive landscape

| Platform | Price (mo) | Approach | Weakness we exploit |
|---|---|---|---|
| TriDot | $15–199 | Algorithmic plans, race prediction, Ironman partner | Expensive at full feature set; rigid; dense, overwhelming UI |
| Athletica | ~$19.90 | Physiology-research-driven, transparent | Dated web-first UX; conservative adaptation; no holistic layer |
| Humango | $9–29 | Budget AI coach "Hugo", reschedules around life | Shallow analytics; dated interface; limited integrations |
| Transition | ~$19 | All-in-one (training+nutrition+strength), mobile-first | Breadth over depth; young engine, thin track record |
| AI Endurance | $13–25 | HRV/ML-driven predictions | Steep learning curve; limited workout variety |
| TrainingPeaks | $0–20 | Analysis + plan marketplace, coach tools | No native adaptive plan generation; static purchased plans |
| Garmin / Strava AI | bundled | Daily suggestions, insights | Suggestions, not goal-directed periodized plans |
| Runna (Strava) | ~$18 | Running plans, mass-market polish | Running only; limited physiology depth |

**Positioning:** *The self-coached athlete's instrument.* Taper competes on three axes simultaneously where no incumbent holds more than one: (1) **explainable prescriptions** — every workout states why it exists and what it builds; (2) **genuinely adaptive** — the plan re-flows daily from readiness and compliance, not weekly from a template; (3) **product craft** — the category's interfaces look like 2015; Taper should look like the best software the athlete owns.

**Pricing intent:** $16.99/mo Core, $26.99/mo Pro, ~35% annual discount. Above Humango (signal quality), at/near Athletica and Transition, far under TriDot's premium tiers.

---

## 5. Product principles

1. **Every workout has a why.** No black boxes: each session names the adaptation it targets and the evidence behind it.
2. **The plan bends, the goal doesn't.** Missed days re-flow the plan; the race date and goal stay fixed until the athlete says otherwise.
3. **Prescribe, don't just describe.** Analytics exist to justify tomorrow's decision, not to decorate dashboards.
4. **Safe by construction.** Ramp-rate caps, recovery floors, and injury-history constraints are hard limits the optimizer cannot cross.
5. **Ten minutes to a plan.** Connect accounts, state the goal, get the season. Onboarding friction is a product defect.

---

## 6. The engine

### Inputs
- **Race goal(s):** event, date, distance, course profile (GPX import), target outcome (finish / time / qualify).
- **Training history:** full import from TrainingPeaks, Strava, Garmin, COROS (FIT/TCX/GPX + workout metadata). Derives current fitness (CTL), durability, discipline balance, historical response to load.
- **Athlete profile:** experience level, age, injury history, weekly availability by day, equipment (trainer, power meter, pool access), preferred long-day.
- **Daily signals:** completed workouts (auto-synced), subjective RPE and session feedback, HRV/sleep/resting HR where available.

### Foundation data
- Founder's multi-year TrainingPeaks corpus (complete triathlon seasons with race outcomes) as the seed dataset for development, feature engineering, and backtesting.
- Published periodization and physiology models (threshold-based zone systems, PMC/impulse-response, taper-duration research) as priors; the proprietary advice algorithm supplies discipline-specific prescription logic for swim, bike, and run.
- Growth path: opt-in anonymized user data pool once volume exists; contribution unlocks aggregate benchmarks.

### Outputs
- **Season plan:** macro (base/build/peak/taper) and mesocycle structure back-cast from race day.
- **Daily structured workouts** per discipline with intervals, targets in the athlete's zones (pace/power/HR), duration variants, and a one-paragraph *why*.
- **Zone calibration:** thresholds re-estimated from breakthrough efforts; zones versioned over time.
- **Readiness-driven adjustment:** each morning the day's session is confirmed, softened, swapped, or dropped based on compliance, reported strain, and recovery signals; the future plan re-flows within safety constraints.
- **Race pack:** course-specific pacing plan, taper schedule, projected finish range with confidence band.

### Evaluation
- Backtest on founder corpus: predicted vs. actual race outcomes; plan similarity to what elite coaching produced.
- Ongoing: predicted-vs-actual race times across users, injury/overtraining incident rate, compliance-weighted fitness delta.

---

## 7. MVP scope — web app

**P0 (launch blockers)**
1. Onboarding wizard: goal → connect accounts → history import → availability/experience → generated season plan in one sitting.
2. Integrations: TrainingPeaks, Strava, Garmin import; daily auto-sync of completed activities.
3. Plan calendar: season → week → day views; drag to swap days within constraints.
4. Workout detail: structure, targets, the why, completion state, post-session feedback (RPE + flags).
5. Adaptive re-flow: missed/modified sessions and feedback re-plan the horizon nightly (and on demand).
6. Structured workout export: FIT/ZWO download; push to Garmin Connect calendar.
7. Fitness dashboard: CTL/ATL/TSB, weekly volume by discipline, threshold history: framed as "why your plan looks like this."
8. Account, subscription billing (Stripe), trial.

**P1 (fast follow)**
- Race pack (pacing + taper detail + projection band).
- COROS integration; Wahoo export.
- Multi-race season (A/B/C priorities).
- Email/weekly digest ("your week, planned").

**P2 (later)**
- Strength/mobility session slots (templated, not yet adaptive).
- Plan sharing / coach read-only view.
- Public API.

**Out of scope for MVP:** native mobile apps, nutrition, social/community features, live in-workout guidance, marketplace.

---

## 8. Phase 2 — mobile

- iOS first (SwiftUI or React Native, decide after MVP), then Android.
- Core loop on mobile: today's workout, readiness check-in, completion feedback, push notifications for plan changes.
- Watch companions ride on exported structured workouts initially; native watch apps deferred.
- Web remains the planning/analysis surface; mobile is the daily-execution surface.

---

## 9. Non-functional requirements

- **Privacy:** health-adjacent data (HRV, HR, sleep) encrypted at rest; GDPR/CCPA compliance; explicit consent for any data pooling; full export and delete. Founder corpus and user data segregated from analytics tooling.
- **Sync reliability:** activity ingest within 15 min of device upload; idempotent dedup across Strava/Garmin/TP overlap.
- **Performance:** plan generation < 30 s; calendar interactions < 100 ms; Core Web Vitals green.
- **Accessibility:** WCAG 2.1 AA; full reduced-motion support.
- **Trust:** versioned algorithm changelog: when the engine changes, athletes see what changed and why.

---

## 10. Success metrics

- **Activation:** ≥ 60% of signups generate a plan in first session; median onboarding < 10 min.
- **Engagement:** ≥ 55% weekly plan compliance (completed/prescribed) at week 8.
- **Retention:** ≥ 45% of trial-to-paid; ≥ 70% of paid still active at week 12 (season length).
- **Outcome:** median |predicted − actual| race time within 5% at MVP, 3% by v2.
- **Quality:** zero algorithm-attributed injury incidents; NPS ≥ 50.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Single-athlete seed corpus overfits | Treat corpus as development/backtest set, physiology priors as the backbone; expand with opt-in pool early |
| API dependence (Strava/Garmin terms) | Multi-source ingest; FIT file upload as universal fallback |
| Category giants add "good enough" AI (Strava×Runna, Garmin) | Win on tri-depth, explainability, and craft; single-sport expansion later, not first |
| Trust: athletes won't follow a robot | The why on every workout; changelog; projection bands instead of point promises |
| Injury liability | Hard safety constraints, conservative defaults, medical disclaimers, incident review loop |
| Solo-founder scope creep | P0 list above is the contract; everything else waits |

---

## 12. Roadmap

| Phase | Window | Milestone |
|---|---|---|
| 0 — Foundation | Now → +6 wk | Data pipeline for TP corpus; engine backtests reproduce founder's real seasons; marketing site + waitlist live |
| 1 — Private alpha | +6 → +14 wk | P0 web app with 10–25 hand-picked athletes; weekly plan-quality reviews |
| 2 — Open beta | +14 → +24 wk | Billing on; P1 features; 200+ athletes through a full build cycle |
| 3 — v1 launch | +24 wk → race season | Public launch timed to spring race registrations; race packs proven at real events |
| 4 — Mobile | post-v1 | iOS daily-execution app |

---

## 13. Open questions

1. Engine architecture: how much of the proprietary algorithm is rules/physiology vs. learned components at MVP?
2. Zone methodology: single house system per discipline, or support athlete-preferred systems (Coggan, Daniels, CSS) from day one?
3. TrainingPeaks relationship: import-only, or bidirectional (Taper as plan source pushing into TP for athletes who live there)?
4. Trial design: time-boxed (14 days) vs. milestone-boxed (first two adapted weeks free)?
5. Brand domain: taper.app / taper.training / jointaper.com availability and cost to be checked before launch collateral.
