import { generatePlan, type PlannedSessionOut, type PlanRequest } from "../../../../engine/plan.ts";
import type { AthleteState } from "../../../../engine/types.ts";
import { deriveZones, type Thresholds, type Zones } from "../../../../engine/zones.ts";
import { getAthlete } from "@/lib/athlete-data";
import { computeTotals, WorkoutStructureView } from "@/components/app/workout-structure";

/**
 * DEV AID — workout-structure renderer preview (keep it).
 *
 * Renders ONE real example of every session type the engine's composer can
 * emit, produced by calling the actual generator (engine/plan.ts
 * `generatePlan`) — NOT hand-built block fixtures. Two real plans (a run race
 * and a triathlon, 7 days/week over ~15 weeks so base → build → taper → race
 * phases all appear) are generated; each distinct template kind is picked out
 * of the emitted sessions by its title and rendered with the full variant and
 * the compact variant side by side under a labeled heading.
 *
 * It works with no corpus: zones fall back to a synthetic athlete-thresholds
 * set and the seed state is synthetic, so the page renders identically whether
 * or not data/ is present. force-dynamic per taper-rules rule 12.
 */
export const dynamic = "force-dynamic";

/* Synthetic fallbacks so the page renders with no corpus. Real zones are used
 * when the corpus is present (nicer paces), but the seed state is always
 * synthetic so phase coverage is deterministic. */
const SYNTH_THRESHOLDS: Thresholds = {
  ftpWatts: 260,
  lthrBpm: 168,
  runThresholdSpeedMps: 4.0, // ~4:10/km threshold
  swimCssMps: 1.35,
};

const SEED: AthleteState = {
  ctl: 45,
  atl: 43,
  tsb: 2,
  last4WeeksTss: [300, 320, 310, 330],
  trailingWeeksTss: [280, 290, 300, 320, 310, 330, 300, 320],
  last4Shares: { swim: 0.15, bike: 0.35, run: 0.5 },
  daysToNextRace: null,
  weeksSinceStart: 20,
  breakRatio: 1,
  daysSinceLastSession: 1,
};

const START = "2026-07-15";
const RACE = "2026-11-01"; // ~15.5 weeks out → base/build/taper/race all present

function buildPlans(zones: Zones) {
  const runReq: PlanRequest = {
    raceName: "Autumn Half",
    raceDate: RACE,
    raceType: "run-half",
    daysPerWeek: 7,
    longDay: "saturday",
    startDate: START,
    maxSessions: 7,
    goalTime: "1:35:00", // triggers periodization; still the real generator path
  };
  const triReq: PlanRequest = {
    raceName: "Harvest Olympic",
    raceDate: RACE,
    raceType: "olympic",
    daysPerWeek: 7,
    longDay: "sunday",
    startDate: START,
    maxSessions: 7,
  };
  const run = generatePlan(runReq, SEED, [], zones);
  const tri = generatePlan(triReq, SEED, [], zones);
  return { run, tri };
}

/** All emitted training/race sessions of a plan, tagged with their phase. */
function allSessions(plan: ReturnType<typeof generatePlan>) {
  return plan.weeks.flatMap((w) =>
    w.sessions.map((s) => ({ s, phase: w.phase, weekStart: w.weekStart }))
  );
}

type Tagged = { s: PlannedSessionOut; phase: string; weekStart: string };

function firstMatch(pool: Tagged[], pred: (t: Tagged) => boolean): Tagged | null {
  return pool.find(pred) ?? null;
}

interface CatalogEntry {
  key: string;
  heading: string;
  /** What a correct render must show — the self-review checklist for this type. */
  expect: string;
  entry: Tagged | null;
}

function buildCatalog(zones: Zones): CatalogEntry[] {
  const { run, tri } = buildPlans(zones);
  const runPool = allSessions(run);
  const triPool = allSessions(tri);
  const raceWeek = run.weeks.find((w) => w.phase === "race");
  const raceWeekPool: Tagged[] = raceWeek
    ? raceWeek.sessions.map((s) => ({ s, phase: raceWeek.phase, weekStart: raceWeek.weekStart }))
    : [];

  return [
    {
      key: "easy",
      heading: "Pure easy run — single block",
      expect:
        "One easy-zone block, no rep group, an easy pace pill, HR cue below. Duration ≈ engine minutes; at-intensity 0.",
      entry: firstMatch(runPool, (t) => /^Easy \d+$/.test(t.s.title)),
    },
    {
      key: "tempo",
      heading: "Tempo intervals",
      expect:
        "Warmup + cooldown easy bars; a tempo rep group N × M min with a tempo pace pill and '2 min easy between'. At-intensity = N×M.",
      entry: firstMatch(runPool, (t) => t.s.title === "Tempo intervals"),
    },
    {
      key: "threshold",
      heading: "Threshold reps (bike)",
      expect:
        "Warmup easy + cooldown recovery; a threshold rep group N × {10,12} min on 5 min recovery, watt target in the cue. No pace pill (watts).",
      entry: firstMatch(triPool, (t) => t.s.title === "Threshold intervals" && t.phase !== "race"),
    },
    {
      key: "vo2",
      heading: "VO2 intervals",
      expect:
        "Warmup/cooldown easy; a VO2 rep group N × 3 min on 90s, hot bright-ember swatch, VO2 pace pill. At-intensity = N×3 min.",
      entry: firstMatch(runPool, (t) => t.s.title === "VO2 set" && t.phase !== "race"),
    },
    {
      key: "progression",
      heading: "Progression / long run — adjacent paced segments",
      expect:
        "Three easy-zone segments (first / middle / last); last segment paced at steady with the 'may drift to steady' cue. Timeline reads as one continuous bar.",
      entry: firstMatch(runPool, (t) => /^Long run/.test(t.s.title)),
    },
    {
      key: "long-ride",
      heading: "Long ride — steady with tempo blocks",
      expect:
        "A long easy main block then 2 × 20 min tempo segments (warmer swatch). Fuel line lives in the text only, not as a block.",
      entry: firstMatch(triPool, (t) => /^Long ride/.test(t.s.title)),
    },
    {
      key: "swim-css",
      heading: "Threshold swim — CSS set (distance-defined)",
      expect:
        "Distance blocks (400 warmup, 10 × 100 CV, 4 × 50 VO2, 200 cooldown). CV vs VO2 swatches differ; rest between reps; distance total, no pace pills.",
      entry: firstMatch(triPool, (t) => t.s.title === "CSS swim set"),
    },
    {
      key: "swim-endurance",
      heading: "Endurance swim — easy distance reps",
      expect:
        "400 warmup, N × 300 easy on 30s rest, 200 cooldown — all easy/recovery swatches, distance total.",
      entry: firstMatch(triPool, (t) => /^Endurance swim/.test(t.s.title)),
    },
    {
      key: "bike-z2",
      heading: "Zone 2 ride — continuous aerobic",
      expect:
        "Warmup ramp, long easy main, recovery-zone cooldown spin; watts in cues, no pace pills. Timeline mostly cool.",
      entry: firstMatch(runPool.concat(triPool), (t) => /^Zone 2 ride/.test(t.s.title)),
    },
    {
      key: "strides",
      heading: "Strides — easy volume + neuromuscular markers",
      expect:
        "Easy segment then strides shown as 5 small vertical markers (not a size bar), 'full recovery' note.",
      entry: firstMatch(runPool, (t) => /strides/.test(t.s.title)),
    },
    {
      key: "sharpener",
      heading: "Taper sharpener — real race-week session",
      expect:
        "Pulled from the generated RACE week: a shortened quality/easy touch. Small totals, freshness-preserving. Real, not a fixture.",
      entry:
        // Prefer a run touch (the classic sharpener); fall back to any
        // non-race session the race week actually contains.
        firstMatch(raceWeekPool, (t) => t.s.discipline === "run") ??
        firstMatch(raceWeekPool, (t) => t.s.discipline !== "race"),
    },
    {
      key: "race",
      heading: "Race-pace work — the race session",
      expect:
        "Single race-zone segment (hottest ember swatch). Prose cue, no reps/pace/size; totals fall back to the engine's stored TSS.",
      entry: firstMatch(runPool, (t) => t.s.discipline === "race"),
    },
  ];
}

function Meta({ s }: { s: PlannedSessionOut }) {
  const derived = computeTotals(s.workout);
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 label-mono text-bone-faint">
      <span>{s.discipline}</span>
      <span>
        engine: {Math.round(s.durationHr * 60)} min · {s.tss} TSS
      </span>
      <span>
        derived: {derived.durationSec != null ? `${Math.round(derived.durationSec / 60)} min` : "—"} ·{" "}
        {derived.tss} TSS
        {derived.distanceM != null && ` · ${derived.distanceEstimated ? "≈" : ""}${derived.distanceM} m`}
      </span>
    </div>
  );
}

function Card({ item }: { item: CatalogEntry }) {
  const t = item.entry;
  return (
    <section className="border border-hairline">
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3 border-b border-hairline">
        <h2 className="display-engraved text-lg">{item.heading}</h2>
        <span className="label-mono text-bone-faint">{item.key}</span>
      </div>

      {!t ? (
        <div className="px-4 py-6 label-mono text-signal-bright">
          NOT PRODUCED by the generator in this run — investigate before trusting the preview.
        </div>
      ) : !t.s.workout ? (
        <div className="px-4 py-6 label-mono text-signal-bright">
          Session &quot;{t.s.title}&quot; carries no workout blocks (text-only) — nothing to render.
        </div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="font-semibold">
              {t.s.title}
              <span className="label-mono text-bone-faint ml-3">
                {t.phase} · {t.s.weekday} {t.s.date.slice(5)}
              </span>
            </span>
          </div>
          <Meta s={t.s} />
          <p className="text-[12.5px] leading-relaxed text-bone-faint max-w-[80ch]">
            <span className="text-bone-muted">Expected:</span> {item.expect}
          </p>

          <div className="grid lg:grid-cols-[1fr_260px] gap-6 pt-1">
            {/* FULL variant */}
            <div>
              <div className="label-mono text-bone-faint mb-3">full</div>
              <WorkoutStructureView
                workout={t.s.workout}
                variant="full"
                stored={{ tss: t.s.tss, durationHr: t.s.durationHr }}
              />
            </div>
            {/* COMPACT variant */}
            <div className="lg:border-l lg:border-hairline lg:pl-6">
              <div className="label-mono text-bone-faint mb-3">compact</div>
              <WorkoutStructureView
                workout={t.s.workout}
                variant="compact"
                stored={{ tss: t.s.tss, durationHr: t.s.durationHr }}
              />
            </div>
          </div>

          {/* Raw derived text, for cross-checking the visual against the string */}
          <details className="pt-1">
            <summary className="label-mono text-bone-faint cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              structure string
            </summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-bone-muted">
              {t.s.structure}
            </pre>
          </details>
        </div>
      )}
    </section>
  );
}

export default function WorkoutPreviewPage() {
  const zones = getAthlete()?.zones ?? deriveZones(SYNTH_THRESHOLDS);
  const usingSynthetic = getAthlete() === null;
  const catalog = buildCatalog(zones);

  return (
    <div>
      <p className="label-mono text-bone-muted">Dev preview</p>
      <h1 className="display-engraved text-3xl mt-1">Workout renderer — every session type</h1>
      <p className="label-mono text-bone-faint mt-2">
        real generator output · {catalog.length} types · zones:{" "}
        {usingSynthetic ? "synthetic fallback" : "corpus"}
      </p>
      <p className="text-[13px] leading-relaxed text-bone-muted mt-3 max-w-[80ch]">
        Each card is one session pulled from a freshly generated plan (engine/plan.ts), rendered
        full + compact. The card&apos;s own totals show the engine&apos;s stored numbers; the
        &quot;derived&quot; debug line recomputes from the blocks. Run derived totals match tightly;
        bike carries an optional &quot;if legs agree&quot; mid-ride surge and swim is distance-only,
        so their derived totals are directional by design (see workout-structure.test.ts). A red
        line means a type failed to generate.
      </p>
      <div className="rule mt-5 mb-8" />

      <div className="space-y-8">
        {catalog.map((item) => (
          <Card key={item.key} item={item} />
        ))}
      </div>
    </div>
  );
}
