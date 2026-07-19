# Taper — Go-to-Market Plan

*Drafted 2026-07-18. Competitor pricing and channel benchmarks researched July 2026 (sources in
the market-audit archive). This plan follows the product's own honesty rule: projections carry
their assumptions, and the $10k/month figure is a modeled outcome, not a promise.*

---

## 1. Positioning

**Category claim:** Taper is the evidence-honest training engine — the only endurance app whose
predictions are backtested against years of real training data, and whose every recommendation
is labeled with how strong the evidence behind it actually is.

**The open lane.** Every high-adaptivity competitor has an honesty or trust problem (Runna's
aggressive paces, Garmin's "deceptive adaptive" backlash, TriDot's opaque claims and billing
complaints, Humango's "too many bugs to trust"). Every honest product (intervals.icu, Runalyze)
has no coaching brain. Taper is positioned to hold both, and the positioning is enforced by the
codebase: a lint fails the build on causal overclaims, including on the marketing pages.

**Three pillars**

1. **The only training app that shows its evidence.** Tiered claims (randomised trial /
   observational / elite practice / our best guess) on every prescription, enforced by CI.
2. **Backtested, not vibes.** Plan targets replayed against multi-year real logs with pinned
   error metrics; goal-gap messaging that says 1:29 when 1:24 isn't reachable.
3. **Honest to your body.** Tissue constraints cap only what an injury provokes, with a
   plain-language why; healthy athletes are never capped prophylactically.

## 2. Competitor map (July 2026 pricing)

| Product | Price | Adaptivity | Honesty/trust |
|---|---|---|---|
| **Taper (proposed)** | Free tier + $14.99/mo or $99/yr | High (adaptive replan; ambient once webhooks land) | High by construction |
| TrainingPeaks | $19.95/mo / $134.99/yr | Low (static plans) | Neutral; dated UI |
| Runna | $19.99/mo / $119.99/yr | Medium | Low: aggressive paces, intensity-heavy |
| Garmin Coach / Connect+ | free w/ device / $6.99/mo | Medium (marketed) | Low: paywall + "deceptive adaptive" backlash |
| intervals.icu | free / $4/mo supporter | None (analytics) | High; the free default to respect |
| TriDot | $14.99–$249/mo | High | Low: opaque claims, billing complaints |
| Athletica.ai | $19.90/mo / $189/yr | High | Medium: monotone workouts, hollow AI feedback |
| Stryd | pod + $14.99/mo | Med-high (pod-gated) | Medium: price-hike backlash |
| Zwift training | $19.99/mo | Low | Low: community "plans to avoid" threads |
| Join.cc | ~€16.99/mo | High | Med-high, cycling-only |
| Humango | $16.99–$28.99/mo | High in design | Low: reliability complaints |
| Runalyze | free / €6/mo | None | High, no coaching layer |
| McMillan | $19.95–$49/mo | Low (templates) | Medium: generic at premium price |

## 3. Pricing

| Tier | Price | Contents |
|---|---|---|
| **Taper Insights** (free, forever) | $0 | PMC/fitness analytics, imports, capability read-outs, the goal-gap check |
| **Taper Pro** | **$14.99/mo · $99/yr** (annual anchored everywhere) | Plan generation, adaptive replan, workout export, readiness, race-day packs, digest |
| Trial | 21 days, card-optional | Full Pro. 17–32-day trials convert ~42.5% vs ~25.5% for short ones (RevenueCat 2026); a plan needs 2–3 weeks to demonstrate adaptation |
| Later: Coach seat | ~$8–12/athlete/mo | Roster digests, red-flag sorting, bounded overrides |

Mechanics that matter more than the price point:

- **Anchor renewal to the race cycle, not the calendar.** Post-race is the churn cliff (~35% of
  annual subs kill auto-renew in month 1). At race completion the product should immediately
  propose the next season, converting the churn moment into the renewal moment.
- **Don't discount below $99/yr.** Category median year-1 realized LTV is ~$32; a sticky $99
  annual roughly triples the ceiling and is what makes any paid acquisition math work
  (LTV:CAC ≥ 3 → blended CAC budget ≈ $30, which rules out broad paid social entirely).
- The free goal-gap check ("is 1:24 realistic for me?") is itself the viral hook.

## 4. The $10k/month math (honest version)

Benchmarks say even top-decile fitness apps take 100+ days to reach their first $10k
*cumulative*; $10k **MRR** is realistically a **month 9–15** outcome for a solo founder. The
90-day plan below builds the machine; faster is upside.

- $10,000 MRR ≈ **~1,000 paying subscribers** at ~$10 blended ARPU (65% annual @$99, 35%
  monthly @$14.99).
- Blended net churn ~6–8%/mo → holding 1,000 needs ~70–80 new payers/mo; building to it inside
  ~12 months needs **~120–150 new payers/mo**.
- At the ~40% category trial→paid median → **300–375 trial starts/mo**.
- At 3–5% visitor→trial (high-intent niche traffic) → **~7,500–12,500 qualified visitors/mo**.

## 5. Channels (in priority order)

1. **Community-first launch in the data-nerd niche** — r/AdvancedRunning, r/running,
   r/triathlon, LetsRun, the intervals.icu-adjacent crowd. Genuine participation and feedback
   threads, never launch posts (engaged community posts convert ~23% vs ~3% for launch-style).
   The "app that publishes its own prediction error and lints its copy for overclaims" story is
   engineered for this audience's skepticism. This is verbatim how intervals.icu grew to 160k
   athletes with zero marketing. Expected: 2–5k visits/mo by day 90; the highest-converting
   traffic available.
2. **The reviewer circuit** — DC Rainmaker, GPLama, The FIT File. The pitch is the
   differentiation itself: a live backtest demo, the evidence-tier UI, goal-gap honesty.
   Expected: spiky 5–20k qualified visits per landed review.
3. **Free-tool SEO wedge** — ship the **Honest Race Predictor** (goal-gap calculator with error
   bars) and a FIT→ZWO converter as free linkable utilities, plus long-tail plan pages
   ("sub-1:45 half marathon plan, 4 days/week"). Don't fight Higdon/Runna head terms.
   Expected: ~500 visits/mo at day 90 compounding to 3–5k/mo by month 9–12; this channel
   eventually carries steady state.

Supporting: Strava share-loop watermark for distribution (never as sole ingest — direct FIT
upload + Garmin keep API risk bounded); one promo-coded podcast test (That Triathlon Show /
Some Work All Play) in days 61–90 only.

## 6. 90-day sequence

**Days 0–30 — credibility hardening + revenue plumbing.**
Ship engineering priorities #1–#6 (validation, stale-CTL family, OAuth security, error
boundaries, caching, import dedupe/labeling — the first four landed 2026-07-18, see §7). Start
multi-user auth + Stripe. **File the Garmin partner-API application now** (long queue, zero
cost). Instrument the funnel. Begin genuine participation in two target communities. Gate: a
stranger can sign up, connect Strava, and nothing embarrassing happens.

**Days 31–60 — differentiation shipping + first public moments.**
Ship workout export (FIT/ZWO) and the readiness signal; launch the free goal-gap calculator.
Multi-user + Stripe live with the 21-day trial and $99 annual anchor. Publish "How we backtest,
and what our error actually is" (simultaneously the DCR pitch, the community post, and the SEO
cornerstone). Send reviewer pitches. Gate: first 100 trials, tracking live.

**Days 61–90 — ambient adaptation + fall-marathon timing.**
Ship Strava webhook auto-sync (the retention feature) before trial cohorts hit their conversion
decision. It's July: fall-marathon blocks start now — run the "16 weeks to your fall marathon,
honestly" push across communities, the calculator, and one podcast test. Review per-channel CAC
and trial→paid vs the 40% benchmark; double down on the winner. Gate: 150–300 cumulative
trials at 40%+ conversion, one earned review landed or queued, weekly content cadence running.

## 7. Engineering roadmap (from the July 2026 audit)

Shipped 2026-07-18: plan-destroying validation gap in `generatePlanAction`; stale-CTL
capability card + "CTL now" mislabel; Strava OAuth state/scope/POST-disconnect; root
error/not-found boundaries; nav `aria-current`; focusable evidence badges; weeklyHours clamp.

Next, in impact order:

| # | Item | Size |
|---|---|---|
| 1 | Caching bundle: Strava snapshot TTL, intervals.icu revalidate, React cache() on corpus readers | M |
| 2 | Import integrity: cross-source dedupe now; wire imports into roll-forward + replan (or label display-only) | S→L |
| 3 | **Structured-workout export (FIT/ZWO/ERG)** — biggest gap vs TrainerRoad/TriDot; serializer seam exists | M |
| 4 | **Strava webhook auto-sync** → auto done-marks, drift-triggered replan (the retention feature) | M |
| 5 | **Readiness signal** (HRV/sleep/RHR via intervals.icu wellness) → existing ease-session machinery | M |
| 6 | **Multi-user auth + per-user datastore + Stripe** — the revenue gate; stores already sit behind src/lib | L |
| 7 | Garmin partner API (file now, integrate when approved) | M |
| 8 | Landing perf: self-host fonts, hero-video source selection, drop 19MB unused videos, retire /classic | S |

## 8. Domain

Registry-checked 2026-07-18 (RDAP): all short premium names (taper.com/.app/.run/.fit/.coach/
.training/.dev, tapertraining.com, gettaper/usetaper/trytaper/taperapp/taperhq.com) are taken.

**Available and recommended:**

| Domain | Status | Use |
|---|---|---|
| **taperrun.com** | available | **Primary.** A real .com, short, says the category |
| **tapertraining.app** | available | App/PWA canonical host or defensive |
| **tapered.run** | available | Memorable redirect for share links |
| tapered.app / taper.works / taper.tools | available | Defensive registrations, optional |

Recommendation: register taperrun.com as primary plus tapertraining.app and tapered.run
defensively (~$40/yr total). Registration is a purchase; do it through your registrar of choice.

## 9. Positioning copy (approved kit)

Hero options: "The training plan that shows its work." · "Backtested targets. Labeled
evidence. No fantasy finish times." · "A coach that tells you what it knows, and what it
doesn't."

Proof points: backtested in the open (pinned error metrics) · overclaims can't ship (CI-enforced
honesty) · we tell athletes no (goal-gap truth).

CTAs: "Build my plan from my data" · "Free to start — connect Strava or upload your files" ·
"Start the 21-day trial. Nothing promised we can't back."

The full copy kit (six feature blurbs + FAQ) lives on `/features` and in the market-audit
archive; all of it passes the honesty lint by construction.
