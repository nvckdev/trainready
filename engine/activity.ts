/**
 * Normalized activity model + cross-source deduplication.
 *
 * The reliability problem this solves: one run pushed from a watch lands in
 * TrainingPeaks, Strava and Apple Health simultaneously. Feeding all three to
 * the reconcile engine would triple-count executed load — which is worse than
 * under-counting, because it would make the engine damp a week the athlete
 * trained exactly as prescribed.
 *
 * Pure module: no I/O, no corpus, no PMC. Connectors normalize INTO this
 * shape; the reconcile path consumes only the deduped canonical stream.
 * Backtest-neutral by construction (engine/backtest.ts never imports it —
 * pinned by A1).
 */

export type ActivitySource = "trainingpeaks" | "strava" | "healthkit" | "file" | "intervals.icu";

/** Sports the plan reasons about. Anything else normalizes to "other" and is
 *  counted as aerobic load but never as running volume. */
export type ActivitySport = "run" | "bike" | "swim" | "strength" | "other";

export interface ImportedActivity {
  source: ActivitySource;
  /** ISO 8601 UTC instant the activity started. The dedup key. */
  startTime: string;
  sport: ActivitySport;
  /** Metres. null for treadmill/indoor work with no GPS — absence must never
   *  be read as zero, and never refutes a time-based match. */
  distanceM: number | null;
  /** Elapsed seconds. */
  durationS: number;
  movingTimeS: number | null;
  avgHr: number | null;
  elevationM: number | null;
  /** The source's own id, for provenance and re-fetch. */
  externalId: string | null;
  /** TSS when the SOURCE supplies it (TrainingPeaks does). null ⇒ the caller
   *  must estimate it; never fabricate one here. */
  tss: number | null;
  /** Every source that contributed to a merged canonical activity. */
  mergedFrom?: ActivitySource[];
}

/** Two activities are the same when they start within this many seconds… */
export const DEDUP_WINDOW_S = 90;
/** …AND their distances agree within this fraction (when both are known). */
export const DEDUP_DISTANCE_FRAC = 0.02;

/**
 * Canonical-source order. TrainingPeaks first because it carries structured
 * workout data and a real TSS; Strava next for GPS/elevation fidelity;
 * HealthKit last (it is the fallback that catches what the others miss).
 * `file` and `intervals.icu` sit between — an explicit upload is more
 * deliberate than a passive health mirror.
 */
export const SOURCE_PRIORITY: ActivitySource[] = [
  "trainingpeaks",
  "strava",
  "intervals.icu",
  "file",
  "healthkit",
];

const rank = (s: ActivitySource) => {
  const i = SOURCE_PRIORITY.indexOf(s);
  return i === -1 ? SOURCE_PRIORITY.length : i;
};

const ms = (iso: string) => Date.parse(iso);

/**
 * Are these two records the same real-world activity?
 *
 * Time is the primary key because it is the one field every source agrees on
 * to within a minute or two. Distance only ever REFUTES a match, and only
 * when both sides know it — a treadmill run has no GPS distance, and reading
 * that absence as "distance 0, therefore different" is exactly the
 * absence-is-not-zero mistake the reconcile engine already had to fix.
 */
export function sameActivity(a: ImportedActivity, b: ImportedActivity): boolean {
  if (a.sport !== b.sport) return false;
  const dt = Math.abs(ms(a.startTime) - ms(b.startTime)) / 1000;
  if (!Number.isFinite(dt) || dt > DEDUP_WINDOW_S) return false;
  if (a.distanceM != null && b.distanceM != null) {
    const scale = Math.max(a.distanceM, b.distanceM);
    if (scale > 0 && Math.abs(a.distanceM - b.distanceM) / scale > DEDUP_DISTANCE_FRAC) return false;
  }
  return true;
}

const pick = <T>(cands: ImportedActivity[], get: (a: ImportedActivity) => T | null | undefined): T | null => {
  for (const c of cands) {
    const v = get(c);
    if (v !== null && v !== undefined) return v;
  }
  return null;
};

/**
 * Merge same-activity records into one canonical activity.
 *
 * Field-level rule: the highest-priority source that actually HAS a value
 * wins. So TrainingPeaks' TSS survives, Strava's elevation fills a gap TP
 * left, and HealthKit's heart rate fills a gap both left — without any
 * lower-priority source ever overwriting a higher-priority value, and without
 * inventing a value no source supplied.
 */
export function mergeCandidates(cands: ImportedActivity[]): ImportedActivity {
  const ordered = [...cands].sort((x, y) => rank(x.source) - rank(y.source));
  const head = ordered[0];
  return {
    source: head.source,
    startTime: head.startTime,
    sport: head.sport,
    distanceM: pick(ordered, (a) => a.distanceM),
    durationS: pick(ordered, (a) => (a.durationS > 0 ? a.durationS : null)) ?? head.durationS,
    movingTimeS: pick(ordered, (a) => a.movingTimeS),
    avgHr: pick(ordered, (a) => a.avgHr),
    elevationM: pick(ordered, (a) => a.elevationM),
    externalId: pick(ordered, (a) => a.externalId),
    tss: pick(ordered, (a) => a.tss),
    mergedFrom: [...new Set(ordered.map((a) => a.source))],
  };
}

/**
 * Collapse a multi-source activity stream into the canonical set.
 *
 * Single-linkage clustering over `sameActivity`, seeded in chronological
 * order so the result does not depend on which connector answered first
 * (pinned by A8e). The output is what the reconcile engine consumes; it must
 * never contain two activities inside the dedup window (pinned by A8a).
 */
export function dedupeActivities(activities: ImportedActivity[]): ImportedActivity[] {
  if (activities.length === 0) return [];
  const sorted = [...activities].sort((a, b) => {
    const d = ms(a.startTime) - ms(b.startTime);
    return d !== 0 ? d : rank(a.source) - rank(b.source);
  });
  const clusters: ImportedActivity[][] = [];
  for (const a of sorted) {
    // Chronological order means only recent clusters can still be in-window.
    let placed = false;
    for (let i = clusters.length - 1; i >= 0; i--) {
      const c = clusters[i];
      if (ms(a.startTime) - ms(c[0].startTime) > DEDUP_WINDOW_S * 1000 * 2) break;
      if (c.some((m) => sameActivity(m, a))) {
        c.push(a);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([a]);
  }
  return clusters
    .map(mergeCandidates)
    .sort((a, b) => ms(a.startTime) - ms(b.startTime));
}

// ——— coverage: what a source can HONESTLY assert about a window ————————————

/**
 * A window a source actually queried. This is the mechanism that keeps
 * "unknown" representable: an activity list means nothing without knowing
 * which dates it was allowed to speak for.
 *
 * A polled source that queried Jul 1–31 and returned three activities is
 * asserting the other 28 days were genuinely empty. A dropped FIT file
 * asserts nothing about any date — so file sources emit NO coverage and may
 * only ever RAISE a week's load, never authorize a zero. A connector that
 * threw emits no coverage either: a failed fetch is not a week of rest.
 */
export interface Coverage {
  source: ActivitySource;
  /** Inclusive ISO date (YYYY-MM-DD). */
  from: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  to: string;
}

const dayMs = 86400000;
const dateOf = (iso: string) => iso.slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * dayMs).toISOString().slice(0, 10);

/** Is every day of the 7-day week starting `weekStart` inside some window? */
export function isWeekCovered(coverage: Coverage[], weekStart: string): boolean {
  if (!coverage.length) return false;
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    if (!coverage.some((c) => c.from <= day && day <= c.to)) return false;
  }
  return true;
}

// ——— TSS ——————————————————————————————————————————————————————————————————

/** Athlete thresholds the estimator can reason against. */
export interface TssContext {
  /** Run threshold speed (m/s), from engine/zones.ts thresholdMpsFromZones. */
  runThresholdMps?: number;
  lthrBpm?: number;
}

/**
 * TSS for an imported activity.
 *
 * Precedence: the SOURCE's own value first (TrainingPeaks and intervals.icu
 * carry real training load — never second-guess a measurement), then a
 * pace-derived intensity for runs, then heart rate, then a per-sport default.
 *
 * All four route through the engine's one load model, TSS = hours · IF² · 100
 * — the same relationship engine/plan.ts uses to turn a session's intensity
 * into load. No second formula is invented here.
 */
export function activityTss(a: ImportedActivity, ctx: TssContext = {}): { tss: number; estimated: boolean } {
  if (a.tss != null && Number.isFinite(a.tss) && a.tss > 0) return { tss: a.tss, estimated: false };
  const hours = a.durationS / 3600;
  if (!(hours > 0)) return { tss: 0, estimated: true };

  let intensity: number | null = null;
  // Pace vs threshold — the most faithful signal for a run with GPS.
  const secs = a.movingTimeS ?? a.durationS;
  if (a.sport === "run" && a.distanceM != null && a.distanceM > 0 && secs > 0 && ctx.runThresholdMps) {
    intensity = a.distanceM / secs / ctx.runThresholdMps;
  }
  // Heart rate as a fraction of threshold HR, when pace is unavailable.
  if (intensity === null && a.avgHr != null && a.avgHr > 0 && ctx.lthrBpm) {
    intensity = a.avgHr / ctx.lthrBpm;
  }
  if (intensity === null) intensity = SPORT_DEFAULT_IF[a.sport];
  // Clamp to a physiologically sane band before squaring: a GPS glitch must
  // not manufacture a 900-TSS session.
  intensity = Math.min(1.15, Math.max(0.45, intensity));
  const tss = hours * intensity * intensity * 100;
  return { tss: Math.min(500, Math.max(5, Math.round(tss * 10) / 10)), estimated: true };
}

/** Flat per-sport intensity fallbacks, used only when neither pace nor HR is
 *  available. Deliberately conservative — an unknown session should not
 *  inflate a week. */
const SPORT_DEFAULT_IF: Record<ActivitySport, number> = {
  run: 0.75,
  bike: 0.7,
  swim: 0.72,
  strength: 0.55,
  other: 0.65,
};

// ——— rollup: the reconcile engine's executed-load input ————————————————————

/**
 * Executed TSS per plan week from a deduped stream — the function that feeds
 * engine/reconcile.ts's executedTssFor.
 *
 * The contract that matters: a week is present in the Map only when some
 * source could HONESTLY speak for it. Present ⇒ authoritative (0 means "we
 * know they trained nothing"); absent ⇒ unknown, and the gate refuses to
 * reflow. Coverage is what separates those two, which is why connectors must
 * report windows rather than just lists.
 */
export function executedByWeek(
  weekStarts: string[],
  activities: ImportedActivity[],
  coverage: Coverage[],
  ctx: TssContext = {},
  /**
   * Authoritative WEEKLY measured load, keyed by weekStart — the derived
   * corpus. A weekly rollup is a different kind of evidence from a session
   * stream and must never be summed with one: doing so double-counts every
   * week that both cover. When a week appears here it wins outright.
   */
  weeklyMeasured?: Map<string, number>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const ws of weekStarts) {
    const measured = weeklyMeasured?.get(ws);
    if (measured !== undefined) {
      out.set(ws, Math.round(measured));
      continue;
    }
    const end = addDays(ws, 6);
    const inWeek = activities.filter((a) => {
      const d = dateOf(a.startTime);
      return d >= ws && d <= end;
    });
    const load = inWeek.reduce((sum, a) => sum + activityTss(a, ctx).tss, 0);
    if (load > 0) {
      // Activities are positive evidence regardless of coverage — a dropped
      // file can raise a week even though it cannot vouch for the empty days.
      out.set(ws, Math.round(load));
    } else if (isWeekCovered(coverage, ws)) {
      // Nothing found, but the week WAS fully queried: an authoritative zero.
      out.set(ws, 0);
    }
    // Otherwise: leave absent. Unknown, not zero.
  }
  return out;
}

/**
 * Merged daily executed TSS: done-marks + imported activities, per calendar
 * day — the evidence map a daily PMC derivation should consume.
 *
 * The failure this exists to prevent: the phone's fitness state was derived
 * from done-marks alone even after imports landed, so a HealthKit athlete who
 * trained six weeks without tapping had their CTL decayed to ~37% of truth
 * and their plan cut ~60% by the very reflow their imports triggered. The
 * gate and the fitness derivation must see the SAME evidence.
 *
 * Per-day rule: MAX(done-marked prescribed TSS, imported measured/estimated
 * TSS), never the sum — a tapped session and its imported twin are the same
 * workout. Max slightly undercounts the rare day with one tapped and one
 * separate import-only session; undercounting one unusual day costs a
 * fraction of a CTL point, double-counting every normal day would corrupt
 * the whole series.
 *
 * `localDate` converts an ISO instant to the athlete's calendar day. The
 * default (UTC slice) preserves existing behavior; callers with a timezone
 * pass their own so evening runs land on the right day.
 */
export function dailyExecutedTss(
  doneByDate: Map<string, number>,
  activities: ImportedActivity[],
  ctx: TssContext = {},
  localDate: (isoInstant: string) => string = (iso) => iso.slice(0, 10)
): Map<string, number> {
  const out = new Map(doneByDate);
  const importedByDate = new Map<string, number>();
  for (const a of activities) {
    const day = localDate(a.startTime);
    importedByDate.set(day, (importedByDate.get(day) ?? 0) + activityTss(a, ctx).tss);
  }
  for (const [day, tss] of importedByDate) {
    out.set(day, Math.max(out.get(day) ?? 0, tss));
  }
  return out;
}
