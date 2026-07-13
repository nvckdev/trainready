import { TaperV1 } from "./learned.ts";
import type { AthleteState, Phase } from "./types.ts";
import type { Zones } from "./zones.ts";

/**
 * Season plan generation: simulate the weeks between now and race day,
 * asking the engine for each week's load as projected fitness evolves, then
 * distribute each week into day-level structured sessions with zone targets
 * and a why. This is the product's core artifact.
 */

export type RaceType =
  | "sprint"
  | "olympic"
  | "half-ironman"
  | "ironman"
  | "run-5k"
  | "run-10k"
  | "run-half"
  | "run-marathon";

export interface PlanRequest {
  raceName: string;
  raceDate: string; // YYYY-MM-DD
  raceType: RaceType;
  daysPerWeek: number; // 4–7
  longDay: "saturday" | "sunday";
  startDate?: string; // defaults to today
  /** Hard cap on training sessions per week (the race itself is protocol and
   *  does not count). Defaults to 5; dropped-slot volume redistributes over
   *  the surviving slots by weight, so the long session keeps its share. */
  maxSessions?: number;
  /** Anchor-v2 load ceiling (see engine/learned.ts). Default OFF; env
   *  TAPER_ANCHOR_V2=1 also enables it. Off = byte-identical legacy path. */
  anchorV2?: boolean;
}

export interface PlannedSessionOut {
  date: string;
  weekday: string;
  discipline: "swim" | "bike" | "run" | "rest" | "race";
  title: string;
  durationHr: number;
  tss: number;
  structure: string;
  why: string;
  status?: "done" | "skipped";
}

export interface PlanWeek {
  weekStart: string;
  phase: Phase;
  targetTss: number;
  projected: { ctl: number; atl: number; tsb: number };
  sessions: PlannedSessionOut[];
}

export interface Plan {
  meta: {
    generatedAt: string;
    engine: string;
    raceName: string;
    raceDate: string;
    raceType: RaceType;
    daysPerWeek: number;
    longDay: "saturday" | "sunday";
    startCtl: number;
    projectedRaceCtl: number;
    projectedRaceTsb: number;
  };
  weeks: PlanWeek[];
}

const RACE_TSS: Record<RaceType, number> = {
  sprint: 95,
  olympic: 180,
  "half-ironman": 340,
  ironman: 560,
  "run-5k": 48,
  "run-10k": 75,
  "run-half": 115,
  "run-marathon": 250,
};

const isTri = (t: RaceType) => !t.startsWith("run-");

// ——— session templates ————————————————————————————————————————

type Kind =
  | "run-easy"
  | "run-strides"
  | "run-long"
  | "run-tempo"
  | "run-vo2"
  | "bike-z2"
  | "bike-threshold"
  | "bike-vo2"
  | "bike-long"
  | "swim-endurance"
  | "swim-threshold";

interface Template {
  discipline: "swim" | "bike" | "run";
  intensity: number; // IF for TSS→duration
  title: (min: number) => string;
  structure: (z: Zones, min: number) => string;
  why: string;
}

const mins = (hr: number) => Math.round((hr * 60) / 5) * 5;

const TEMPLATES: Record<Kind, Template> = {
  "run-easy": {
    discipline: "run",
    intensity: 0.67,
    title: (m) => `Easy ${m}`,
    structure: (z, m) => `${m} min easy @ ${z.run.easy}. HR is the governor; slow down before you speed up.`,
    why: "Aerobic volume at low cost: the base everything else stands on.",
  },
  "run-strides": {
    discipline: "run",
    intensity: 0.68,
    title: (m) => `Easy ${m} + strides`,
    structure: (z, m) =>
      `${m - 5} min easy @ ${z.run.easy}\nthen 5 × strides @ ${z.run.strides}, full recovery`,
    why: "Easy volume plus neuromuscular touch: turnover stays sharp while the aerobic system does the work.",
  },
  "run-long": {
    discipline: "run",
    intensity: 0.72,
    title: (m) => `Long run ${m}`,
    structure: (z, m) =>
      `${m} min continuous:\n· first ${Math.round(m * 0.3)} min @ ${z.run.easy}\n· middle @ ${z.run.easy} settling into rhythm\n· last ${Math.round(m * 0.15)} min may drift to ${z.run.steady} if form holds`,
    why: "The week's cornerstone: durability, fuel economy, and time on feet.",
  },
  "run-tempo": {
    discipline: "run",
    intensity: 0.8,
    title: () => "Tempo intervals",
    structure: (z, m) => {
      const work = Math.max(15, Math.round(m * 0.4));
      const reps = Math.max(2, Math.round(work / 8));
      return `WARMUP ${Math.round(m * 0.3)} min easy @ ${z.run.easy} + 2 strides\nMAIN ${reps} × ${Math.round(work / reps)} min @ ${z.run.tempo} on 2 min easy\nCOOLDOWN ${Math.round(m * 0.2)} min easy`;
    },
    why: "Raises the sustainable-pace ceiling: the engine's race-day workhorse.",
  },
  "run-vo2": {
    discipline: "run",
    intensity: 0.84,
    title: () => "VO2 set",
    structure: (z, m) => {
      const reps = Math.max(4, Math.round((m * 0.3) / 3));
      return `WARMUP ${Math.round(m * 0.33)} min easy @ ${z.run.easy} + 2 strides\nMAIN ${reps} × 3 min @ ${z.run.vo2} on 90s easy\nCOOLDOWN ${Math.round(m * 0.25)} min easy`;
    },
    why: "Touches the aerobic ceiling so threshold has somewhere to grow.",
  },
  "bike-z2": {
    discipline: "bike",
    intensity: 0.65,
    title: (m) => `Zone 2 ride ${m}`,
    structure: (z, m) => `WARMUP 10 min ramp to ${z.bike.z2}\nMAIN ${m - 15} min steady @ ${z.bike.z2}\nCOOLDOWN 5 min easy spin`,
    why: "Aerobic load with zero impact: volume the legs don't have to pay for.",
  },
  "bike-threshold": {
    discipline: "bike",
    intensity: 0.8,
    title: () => "Threshold intervals",
    structure: (z, m) => {
      const reps = m >= 75 ? 3 : 2;
      return `WARMUP 12 min ramp + 3 × 30s @ ${z.bike.vo2}\nMAIN ${reps} × ${m >= 75 ? 12 : 10} min @ ${z.bike.threshold} on 5 min easy\nCOOLDOWN 8 min spin`;
    },
    why: "FTP work: moves the number every other bike target hangs off.",
  },
  "bike-vo2": {
    discipline: "bike",
    intensity: 0.83,
    title: () => "VO2 bike set",
    structure: (z) => `WARMUP 15 min with 4 × 20s openers\nMAIN 6 × 2 min @ ${z.bike.vo2} on 2 min easy\nCOOLDOWN 10 min spin`,
    why: "Short hard repeats lift aerobic power without wrecking the week.",
  },
  "bike-long": {
    discipline: "bike",
    intensity: 0.68,
    title: (m) => `Long ride ${Math.round(m / 60 * 10) / 10}h`,
    structure: (z, m) =>
      `${m} min mostly @ ${z.bike.z2}\ninclude 2 × 20 min @ ${z.bike.tempo} in the middle if legs agree\nfuel: 60–90g carbs/hr from minute 20`,
    why: "Race-day durability and fueling practice in one session.",
  },
  "swim-endurance": {
    discipline: "swim",
    intensity: 0.6,
    title: (m) => `Endurance swim ${m}`,
    structure: (z, m) => {
      const main = Math.max(3, Math.round((m - 20) / 8));
      return `WARMUP 400 easy mixed\nMAIN ${main} × 300 @ ${z.swim.easy} on 30s rest\nCOOLDOWN 200 choice`;
    },
    why: "Feel for the water is rented, never owned: frequency keeps the lease.",
  },
  "swim-threshold": {
    discipline: "swim",
    intensity: 0.7,
    title: () => "CSS swim set",
    structure: (z) =>
      `WARMUP 400 as 50 drill/50 swim\nMAIN 10 × 100 @ ${z.swim.threshold} on 20s rest\n4 × 50 @ ${z.swim.vo2} on 30s\nCOOLDOWN 200 easy`,
    why: "Critical-swim-speed work: open-water pace without open-water chaos.",
  },
};

// ——— weekly slot layout ————————————————————————————————————————

interface Slot {
  weekdayIdx: number; // 0 = Monday
  kind: Kind;
  weight: number;
}

// Priority to KEEP when a template yields more slots than daysPerWeek
// (highest first): long ride, long run, the quality run, bike work, then
// fillers and swims. Applied generically so future template edits cannot
// silently exceed the athlete's chosen days.
const KEEP_PRIORITY: Kind[] = [
  "bike-long",
  "run-long",
  "run-vo2",
  "run-tempo",
  "bike-threshold",
  "bike-z2",
  "run-strides",
  "run-easy",
  "swim-threshold",
  "swim-endurance",
];

/** Drop lowest-priority slots until the week fits daysPerWeek. Survivors
 * keep their original weekdayIdx — no redistribution. */
function capToDays(slots: Slot[], daysPerWeek: number): Slot[] {
  const out = [...slots];
  while (out.length > daysPerWeek) {
    let drop = 0;
    for (let i = 1; i < out.length; i++) {
      if (KEEP_PRIORITY.indexOf(out[i].kind) >= KEEP_PRIORITY.indexOf(out[drop].kind)) drop = i;
    }
    out.splice(drop, 1);
  }
  return out;
}

const DEFAULT_MAX_SESSIONS = 5;

function slotsFor(req: PlanRequest, phase: Phase): Slot[] {
  const longIdx = req.longDay === "saturday" ? 5 : 6;
  const otherWeekend = req.longDay === "saturday" ? 6 : 5;
  const quality: Kind = phase === "base" || phase === "offseason" ? "run-tempo" : "run-vo2";
  // Sessions/week is the tighter of the athlete's available days and the
  // maxSessions cap (default 5). Applies to TRAINING slots only: the race
  // session is protocol, appended downstream, and exempt from the count.
  // capToDays drops lowest-priority slots and the fixed weekly TSS then
  // redistributes over the survivors' weights, so the long session keeps
  // its (largest) share of the volume.
  const cap = Math.min(
    req.daysPerWeek,
    Math.max(3, Math.round(req.maxSessions ?? DEFAULT_MAX_SESSIONS))
  );

  if (!isTri(req.raceType)) {
    const slots: Slot[] = [
      { weekdayIdx: 1, kind: quality, weight: 1.15 },
      { weekdayIdx: 3, kind: "run-tempo", weight: 1.1 },
      { weekdayIdx: 4, kind: "run-strides", weight: 0.75 },
      { weekdayIdx: longIdx, kind: "run-long", weight: 1.7 },
    ];
    if (req.daysPerWeek >= 5) slots.push({ weekdayIdx: 2, kind: "run-easy", weight: 0.8 });
    if (req.daysPerWeek >= 6) slots.push({ weekdayIdx: otherWeekend, kind: "run-easy", weight: 0.85 });
    if (req.daysPerWeek >= 7) slots.push({ weekdayIdx: 0, kind: "bike-z2", weight: 0.6 });
    return capToDays(slots, cap);
  }

  const slots: Slot[] = [
    { weekdayIdx: 1, kind: quality, weight: 1.0 },
    { weekdayIdx: 2, kind: "swim-threshold", weight: 0.6 },
    { weekdayIdx: 3, kind: phase === "build" || phase === "taper" ? "bike-threshold" : "bike-z2", weight: 1.05 },
    { weekdayIdx: longIdx, kind: "bike-long", weight: 1.6 },
    { weekdayIdx: otherWeekend, kind: "run-long", weight: 1.25 },
  ];
  if (req.daysPerWeek >= 6) slots.push({ weekdayIdx: 4, kind: "swim-endurance", weight: 0.55 });
  if (req.daysPerWeek >= 7) slots.push({ weekdayIdx: 0, kind: "run-easy", weight: 0.6 });
  return capToDays(slots, cap);
}

// ——— date helpers ————————————————————————————————————————————

const DAY = 86400000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

function mondayOnOrAfter(dateStr: string): number {
  const t = Date.parse(dateStr + "T12:00:00Z");
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return dow === 0 ? t : t + (7 - dow) * DAY;
}

function mondayOnOrBefore(dateStr: string): number {
  const t = Date.parse(dateStr + "T12:00:00Z");
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return t - dow * DAY;
}

// ——— generation ————————————————————————————————————————————————

export function generatePlan(
  req: PlanRequest,
  initialState: AthleteState,
  history: Array<{ state: AthleteState; actualTss: number; weekStart?: string }>,
  zones: Zones
): Plan {
  const engine = new TaperV1(req.anchorV2 === undefined ? {} : { anchorV2: req.anchorV2 });
  for (const h of history) engine.observe(h.state, h.actualTss, h.weekStart);

  const raceT = Date.parse(req.raceDate + "T12:00:00Z");
  const startDateStr = req.startDate ?? iso(Date.now());
  if (req.raceDate < startDateStr) throw new Error("race date is in the past");
  // Mid-week signup for a race that same week (e.g. Tue signup, Sat race):
  // next Monday would overshoot the race, so anchor on the CURRENT week's
  // Monday instead and filter pre-startDate sessions out of the emitted week.
  let start = mondayOnOrAfter(startDateStr);
  if (start > raceT) start = mondayOnOrBefore(startDateStr);

  let ctl = initialState.ctl;
  let atl = initialState.atl;
  const last8: number[] = [...initialState.last4WeeksTss];
  let weeksSinceStart = initialState.weeksSinceStart;
  let raceMorning: { ctl: number; tsb: number } | null = null;
  let prevPrescribed: number | undefined; // week 1 has none (see AthleteState)

  const weeks: PlanWeek[] = [];

  for (let wStart = start; wStart <= raceT; wStart += 7 * DAY) {
    const daysToRace = Math.round((raceT - wStart) / DAY);
    const last4 = last8.slice(-4);
    const state: AthleteState = {
      ctl,
      atl,
      tsb: ctl - atl,
      last4WeeksTss: last4,
      trailingWeeksTss: [...last8],
      prevPrescribedTss: prevPrescribed,
      last4Shares: initialState.last4Shares,
      daysToNextRace: daysToRace,
      weeksSinceStart,
      breakRatio:
        last8.length >= 2
          ? mean(last8.slice(-2)) / Math.max(1, mean(last8))
          : 1,
      daysSinceLastSession: 1,
    };
    const p = engine.prescribeWeek(state);
    const raceWeek = daysToRace <= 6;

    // Race day consumes part of a race week's budget.
    const raceTss = RACE_TSS[req.raceType];
    const trainableTss = raceWeek ? Math.max(40, p.weekTss * 0.55) : p.weekTss;

    const slots = slotsFor(req, p.phase)
      .filter((s) => iso(wStart + s.weekdayIdx * DAY) < req.raceDate)
      .sort((a, b) => a.weekdayIdx - b.weekdayIdx);
    // Race weeks keep only short sharpeners.
    const active = raceWeek
      ? slots.filter((s) => !s.kind.includes("long")).map((s) => ({ ...s, weight: s.weight * 0.6 }))
      : slots;

    const totalWeight = active.reduce((s, x) => s + x.weight, 0) || 1;
    // No "long" session inside the final 6 days before the gun, even when the
    // race falls early in a week (a Monday race makes the preceding taper week
    // NOT a race week, yet its weekend long slots land the day before the
    // start line). The dropped share is NOT redistributed — race proximity
    // simply makes the week lighter, which is correct.
    const placed = active.filter(
      (s) => !(s.kind.includes("long") && wStart + s.weekdayIdx * DAY >= raceT - 6 * DAY)
    );
    const sessions: PlannedSessionOut[] = placed.map((slot) => {
      const t = TEMPLATES[slot.kind];
      const tss = (trainableTss * slot.weight) / totalWeight;
      let durationHr = tss / (t.intensity * t.intensity * 100);
      durationHr = Math.min(slot.kind === "bike-long" ? 4.5 : slot.kind === "run-long" ? 2.6 : 1.6, Math.max(0.4, durationHr));
      const m = mins(durationHr);
      const date = iso(wStart + slot.weekdayIdx * DAY);
      return {
        date,
        weekday: WEEKDAYS[slot.weekdayIdx],
        discipline: t.discipline,
        title: t.title(m),
        durationHr: Math.round(durationHr * 100) / 100,
        tss: Math.round(tss),
        structure: t.structure(zones, m),
        why: t.why,
      };
    });

    if (raceWeek) {
      const raceDow = (new Date(raceT).getUTCDay() + 6) % 7;
      sessions.push({
        date: req.raceDate,
        weekday: WEEKDAYS[raceDow],
        discipline: "race",
        title: req.raceName,
        durationHr: Math.round((raceTss / 81) * 100) / 100, // ≈ IF 0.9
        tss: raceTss,
        structure: `Race day. Pacing pack ships with the final taper revision; execute, don't improvise.`,
        why: "Everything above this line existed for today.",
      });
    }

    // Simulate PMC through the week, day by day.
    const tssByDate = new Map(sessions.map((s) => [s.date, s.tss] as [string, number]));
    for (let d = 0; d < 7; d++) {
      const dayIso = iso(wStart + d * DAY);
      if (dayIso === req.raceDate) {
        raceMorning = { ctl: r1(ctl), tsb: r1(ctl - atl) };
      }
      const dayTss = tssByDate.get(dayIso) ?? 0;
      ctl = ctl + (dayTss - ctl) / 42;
      atl = atl + (dayTss - atl) / 7;
    }
    // Projected = the state at the week's END, i.e. after the loop has
    // absorbed the week's sessions. (Snapshotting before the loop shipped
    // every card one week stale: week 1 showed the untouched seed.) TSB keeps
    // the yesterday-CTL−ATL convention: Sunday night's CTL/ATL are exactly
    // "yesterday" to the Monday morning the athlete wakes into.
    const projected = { ctl: r1(ctl), atl: r1(atl), tsb: r1(ctl - atl) };

    // A plan may start mid-week (see the mondayOnOrBefore fallback): the PMC
    // simulation above still runs the full Monday-anchored week, but sessions
    // dated before the start are never emitted — don't prescribe the past.
    const emitted = sessions.filter((s) => s.date >= startDateStr);

    weeks.push({
      weekStart: iso(wStart),
      phase: p.phase,
      targetTss: Math.round(emitted.reduce((s, x) => s + x.tss, 0)),
      projected,
      sessions: emitted,
    });

    last8.push(p.weekTss);
    if (last8.length > 8) last8.shift();
    prevPrescribed = p.weekTss;
    weeksSinceStart++;
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      engine: engine.name + (history.length ? `(${history.length}w)` : "(cold)"),
      raceName: req.raceName,
      raceDate: req.raceDate,
      raceType: req.raceType,
      daysPerWeek: req.daysPerWeek,
      longDay: req.longDay,
      startCtl: r1(initialState.ctl),
      projectedRaceCtl: raceMorning ? raceMorning.ctl : r1(ctl),
      projectedRaceTsb: raceMorning ? raceMorning.tsb : r1(ctl - atl),
    },
    weeks,
  };
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const r1 = (n: number) => Math.round(n * 10) / 10;
