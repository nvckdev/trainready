import { readFileSync } from "node:fs";

/**
 * Turn stored plan sessions into TrainingPeaks workout payloads.
 *
 * Pure and offline: reads data/app/plan.json plus the athlete's run threshold
 * and prints one payload per session as JSON. The skill's agent does the MCP
 * calls; this file exists so nobody hand-assembles interval JSON, which is
 * exactly where a wrong number reaches someone's wrist.
 *
 *   npx tsx .claude/skills/taper-watch-export/build-payload.ts <from> <to>
 *
 * Every payload carries `pushable` and, when false, `reason`. A session that
 * cannot be described honestly is never pushed — a watch is a device someone
 * follows while running, so a contradictory instruction there is worse than
 * no instruction at all.
 */

interface Block {
  kind: string;
  zone: string;
  durationSec?: number;
  reps?: number;
  recoverySec?: number;
  paceMinSecPerKm?: number;
  paceMaxSecPerKm?: number;
  effortNote?: string;
  recoveryNote?: string;
}

interface Session {
  date: string;
  weekday: string;
  discipline: string;
  title: string;
  durationHr: number;
  tss: number;
  structure: string;
  why: string;
  status?: string;
  workout?: { blocks: Block[] };
  tuneup?: boolean;
}

const [, , fromArg, toArg] = process.argv;
if (!fromArg || !toArg) {
  console.error("usage: build-payload.ts <from YYYY-MM-DD> <to YYYY-MM-DD>");
  process.exit(2);
}

const stored = JSON.parse(readFileSync("data/app/plan.json", "utf8"));
const athlete = JSON.parse(readFileSync("data/raw/athlete.json", "utf8"));
/** The engine's own run threshold — the same field generatePlan derives zones
 *  from, so exported percentages agree with the paces already in the plan. */
const thresholdMps: number =
  athlete.thresholds.runThresholdSpeedMpsAlt ?? athlete.thresholds.runThresholdSpeedMps;

const SPORT: Record<string, string> = { run: "Run", bike: "Bike", swim: "Swim", race: "Race" };

/** Seconds a block occupies on the clock, reps and inter-rep recovery included. */
function blockSeconds(b: Block): number {
  const reps = b.reps ?? 1;
  const work = (b.durationSec ?? 0) * reps;
  const recov = (b.recoverySec ?? 0) * Math.max(0, reps - 1);
  return work + recov;
}

/** Pace (sec/km) → percent of threshold SPEED. A slower pace is a bigger
 *  sec/km and a lower percentage, so min/max invert on the way through. */
const pctOfThreshold = (secPerKm: number) => Math.round((1000 / secPerKm / thresholdMps) * 1000) / 10;

function paceLabel(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

interface Step {
  name: string;
  duration_seconds: number;
  intensity_min: number;
  intensity_max: number;
}

/** Expand a block into flat steps. The simplified TP structure has no nesting
 *  and ignores a `repeat` field, so reps are written out — which is also what
 *  a watch actually executes, one step at a time. */
function expand(b: Block, index: number, total: number): Step[] {
  const reps = b.reps ?? 1;
  const dur = b.durationSec ?? 0;
  if (dur <= 0) return [];
  // Percentages come from the block's own pace window when it has one; the
  // zone fallbacks match the engine's zone table for structureless blocks.
  const fast = b.paceMinSecPerKm;
  const slow = b.paceMaxSecPerKm;
  const lo = slow ? pctOfThreshold(slow) : zoneFallback(b.zone)[0];
  const hi = fast ? pctOfThreshold(fast) : zoneFallback(b.zone)[1];
  const base =
    b.kind === "warmup" ? "Warm up" : b.kind === "cooldown" ? "Cool down" : b.kind === "strides" ? "Strides" : label(b.zone);
  const out: Step[] = [];
  for (let r = 0; r < reps; r++) {
    out.push({
      name: reps > 1 ? `${base} ${r + 1}/${reps}` : index === 0 && total > 1 ? base : base,
      duration_seconds: dur,
      intensity_min: lo,
      intensity_max: hi,
    });
    if (r < reps - 1 && (b.recoverySec ?? 0) > 0) {
      out.push({
        name: "Recovery",
        duration_seconds: b.recoverySec!,
        intensity_min: zoneFallback("recovery")[0],
        intensity_max: zoneFallback("recovery")[1],
      });
    }
  }
  return out;
}

function label(zone: string): string {
  return zone === "vo2" ? "VO2" : zone === "threshold" ? "Threshold" : zone === "tempo" ? "Tempo" : zone === "cv" ? "CV" : "Easy";
}

/** Percent-of-threshold-speed windows, mirroring engine/zones.ts bands. */
function zoneFallback(zone: string): [number, number] {
  switch (zone) {
    case "recovery": return [60, 72];
    case "easy": return [72, 85];
    case "tempo": return [88, 94];
    case "threshold": return [95, 100];
    case "cv": return [100, 104];
    case "vo2": return [104, 112];
    case "race": return [95, 105];
    default: return [72, 85];
  }
}

const sessions: Session[] = stored.plan.weeks.flatMap((w: { sessions: Session[] }) => w.sessions);
const out = [];

for (const s of sessions) {
  if (s.date < fromArg || s.date > toArg) continue;
  if (s.discipline === "rest") continue;

  const sport = SPORT[s.discipline] ?? "Other";
  const declaredSec = Math.round(s.durationHr * 3600);
  const blocks = s.workout?.blocks ?? [];
  const structuredSec = blocks.reduce((a, b) => a + blockSeconds(b), 0);
  const steps = blocks.flatMap((b, i) => expand(b, i, blocks.length));

  // Pace lines for the description, so the athlete sees real targets even if
  // the watch renders percentages.
  const paceLines = blocks
    .filter((b) => b.paceMinSecPerKm && b.paceMaxSecPerKm)
    .map((b) => `${label(b.zone)}: ${paceLabel(b.paceMaxSecPerKm!)}–${paceLabel(b.paceMinSecPerKm!)}/km`);
  const description = [s.structure, "", s.why, "", ...new Set(paceLines), "", "— Taper"].filter((x) => x !== undefined).join("\n");

  let pushable = true;
  let reason: string | undefined;

  if (s.status === "done") {
    pushable = false;
    reason = "already completed in the plan";
  } else if (!steps.length) {
    pushable = false;
    reason = "no structured blocks to export";
  } else if (declaredSec > 0 && Math.abs(structuredSec - declaredSec) / declaredSec > 0.25) {
    // The plan's own structure disagrees with its own duration. That happens
    // after a reflow damp: engine/replan.ts scaleWeek rescales tss and
    // durationHr but leaves title/structure/workout describing the original
    // session. Exporting either number would put a contradiction on the
    // watch, so this refuses and names the discrepancy.
    pushable = false;
    reason = `structure says ${Math.round(structuredSec / 60)} min but the plan schedules ${Math.round(
      declaredSec / 60
    )} min (${(structuredSec / declaredSec).toFixed(1)}×) — stale after a reflow damp; not exporting a contradiction`;
  }

  // Native TP payload. The simplified `structure` path hardcodes
  // primaryIntensityMetric to percentOfFtp even for a run, which is the wrong
  // yardstick on a wrist; the native payload accepts percentOfThresholdPace.
  // Steps stay FLAT rather than using TP repetition groups: a repetition of
  // [work, recovery] runs the recovery after the LAST rep too, which would
  // add a recovery period the engine never planned. Flat keeps total duration
  // exactly equal to the session the plan scheduled.
  let cursor = 0;
  const groups = steps.map((st) => {
    const begin = cursor;
    cursor += st.duration_seconds;
    const cls = /Warm up/.test(st.name) ? "warmUp" : /Cool down/.test(st.name) ? "coolDown" : /Recovery/.test(st.name) ? "rest" : "active";
    return {
      type: "step",
      length: { value: 1, unit: "repetition" },
      begin,
      end: cursor,
      steps: [
        {
          name: st.name,
          type: "step",
          length: { value: st.duration_seconds, unit: "second" },
          targets: [{ minValue: st.intensity_min, maxValue: st.intensity_max }],
          intensityClass: cls,
          openDuration: false,
        },
      ],
    };
  });
  // TP renders this preview bar; each step contributes a rise, a plateau and
  // a fall, x normalised to total duration and y as the intensity fraction.
  const totalSec = cursor || 1;
  const polyline: number[][] = [];
  let px = 0;
  for (const st of steps) {
    const x0 = Math.round((px / totalSec) * 10000) / 10000;
    px += st.duration_seconds;
    const x1 = Math.round((px / totalSec) * 10000) / 10000;
    const y = Math.round(st.intensity_max) / 100;
    polyline.push([x0, 0], [x0, y], [x1, y], [x1, 0]);
  }

  out.push({
    date: s.date,
    sport,
    title: s.title,
    description,
    duration_minutes: Math.round(declaredSec / 60),
    tss_planned: s.tss,
    structured_workout: {
      primaryLengthMetric: "duration",
      primaryIntensityMetric: sport === "Run" ? "percentOfThresholdPace" : "percentOfFtp",
      primaryIntensityTargetOrRange: "range",
      polyline,
      structure: groups,
    },
    structured_minutes: Math.round(structuredSec / 60),
    pushable,
    ...(reason ? { reason } : {}),
  });
}

console.log(JSON.stringify({ from: fromArg, to: toArg, thresholdMps, count: out.length, sessions: out }, null, 1));
