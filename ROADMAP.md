# Taper — Status & Roadmap

Working ledger of what is built, what is missing, and every integration on
the table. Companion to [PRD.md](PRD.md) (product definition) and
[DESIGN.md](DESIGN.md) (visual system). Updated 2026-07-12.

---

## Done

### Data & engine
- **TrainingPeaks corpus** (data/, gitignored): 2022-09 → today, ~1.6k unique
  workouts, dedupe/normalize/derive pipeline with CTL-MAE 0.20 validation
  gate against TP's own PMC (`npm run pipeline`).
- **Reference engine + learned engine (taper-v1)**: walk-forward trained on
  183 weeks; pinned backtest baselines (consistent-week MAE ≤ 88.2,
  corr ≥ 0.80, direction ≥ 74%) enforced by scripts/verify.sh pre-commit.
- **Taper protocol lock**: taper/race weeks always use the reference
  protocol — the model cannot learn historical under-tapering.
- **Safety rails** (hard limits): weekly ramp ≤ +15% (or +20% over
  trailing-month mean), TSB floor −25 forces recovery, 60-TSS weekly floor.
- **Plan generator**: goal-backed season (race → phases → weeks → sessions),
  zones re-derived from history, per-session structure + rationale.

### App (src/app/app)
- Today / Plan / Fitness / Start pages reading the local corpus.
- Weekly volume brief: target TSS, hours, estimated run mileage, remaining
  load, and "why this volume" (phase goal, ramp vs cap, projected TSB).
- Per-session "acceptable adjustments" (feeling strong / flat / rough) with
  TSB-aware nudge.
- Session done/undo tracking; daily re-flow of missed sessions.
- Strava OAuth connect for the deployed site (estimated PMC + weekly
  mileage from last 120 days; tokens in httpOnly cookie, no server storage).

### Marketing & deployment
- Animated video marketing site at `/` (Seedance 2.0 footage, two-tier
  HD/mobile delivery), old landing archived at `/classic`, standalone copy
  at taper-animated.vercel.app.
- Production: trainready-taupe.vercel.app (deployed app intentionally has
  no health data; corpus is local-only by privacy rule).

---

## Missing / next

### Engine
- [ ] **Era-weighted training**: weight the athlete's designated peak block
      more heavily than recent reduced-volume months when learning load
      tolerance; treat current fitness as ramp *starting point*, peak era as
      *capability ceiling* (top athlete request).
- [ ] Plan-generator edge cases (taper-plan-hardening skill): I2 days-per-week
      overshoot, I3 short-notice races, I4 Monday-race sharpeners.
- [ ] America/New_York date handling (hardening Fix 4).
- [ ] Race-file course match (climbs/surface/heat → long-day design) — PRD
      feature, currently marketing copy only.

### Product
- [ ] **Intake questionnaire** (onboarding): discipline mode
      (running-only / triathlon / bike or swim focus), available hours &
      days, injury history and current niggles, strength-training access,
      experience level, goal race(s). Plans must consume all of it.
- [ ] **Discipline modes**: running-only vs full triathlon plan generation
      (engine already speaks disciplines; needs request-level switch + UI).
- [ ] **Strength & injury-prevention protocols**: templated strength
      sessions (e.g. calf/soleus eccentric loading, hip stability, plyo
      progression) woven into the week; injury-aware session substitution
      (e.g. active calf issue → downgrade hill/speed work, add rehab block).
- [ ] Coach-style plan explanations at season level (why this block, what
      the next 4 weeks do).
- [ ] Session push to devices (see integrations).
- [ ] Multi-user auth + per-user datastore (today: single local athlete;
      deployed dashboard is view-only estimates via Strava).

### Ops
- [ ] Strava app credentials in Vercel env (STRAVA_CLIENT_ID/SECRET) —
      API application created 2026-07-12; icon upload + env vars pending.
- [ ] Custom domain.

---

## Integrations — the full menu

| Integration | What it gives Taper | API status | Effort | Priority |
|---|---|---|---|---|
| **TrainingPeaks** (read) | Full coached history: workouts, PMC, zones, plans | ✅ built (local MCP extraction pipeline) | done | done |
| **Strava** (read) | Activities, relative effort, deployed-dashboard login | ✅ built (OAuth); credentials pending | done | now |
| **Garmin Connect** (read) | Native watch data: HR/HRV, sleep, body battery, running dynamics | Public partner API (approval queue) | M | high |
| **Garmin Connect** (push) | Structured workouts straight to the watch | Same partner API (Training API) | M | high — biggest UX win |
| **COROS** (read/push) | Same for COROS watches | Partner API (application required) | M | med |
| **Wahoo** (push) | Structured bike workouts to head units | Public API | S–M | med |
| **intervals.icu** (read) | Free aggregation layer (Garmin/Strava in one), wellness data | Open API, self-serve key | S | high — cheapest full-history source |
| **Whoop / Oura** (read) | Recovery, HRV, sleep → daily readiness input to re-planning | Public APIs | M | med — powers feeling-based auto-adjust |
| **Apple Health / HealthKit** | HR, sleep, workouts from Apple Watch | Requires iOS app | L | later (needs mobile app) |
| **Runalyze / Golden Cheetah** | Power-user analytics import | File-based | S | low |
| **FIT/TCX/GPX file upload** | Manual import for anyone, no API needed | n/a | S | high — universal fallback |
| **Weather (Open-Meteo)** | Heat/wind-aware session guidance, race-day conditions | Free API | S | med |
| **Race calendars (Ahotu/local)** | Goal-race discovery + course files | Scrape/API mix | M | low |
| **Push notifications / email (Resend)** | Morning session brief delivery | Simple | S | med |
| **Calendar (Google/ICS)** | Sessions on the athlete's calendar | ICS feed is trivial | S | med |

Recommended order: FIT-file upload → intervals.icu → Garmin read →
Garmin push → Whoop/Oura readiness → weather.

---

## Standing rules (never regress)

1. Health data never enters git — data/ is gitignored; deployed site holds
   no corpus. Remote sources (Strava) keep tokens client-side only.
2. Backtest baselines and the phase-0 CTL gate are acceptance criteria for
   any engine/pipeline change (scripts/verify.sh).
3. The taper is protocol, not preference.
