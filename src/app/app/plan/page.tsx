import { hasCorpus, localToday } from "@/lib/athlete-data";
import { readPlan } from "@/lib/plan-io";
import { weekIntensity, type WeekIntensity } from "@/lib/week-insights";
import { evidenceFor, TIER_LABEL, TIER_TONE } from "@/lib/evidence";
import { EmptyState, SessionCard, StatChip } from "@/components/app/bits";
import { RaceDayCard } from "@/components/app/race-cards";
import { getRaceDayPlan } from "@/lib/race-insights";
import { replanAction } from "../actions";

export const dynamic = "force-dynamic";

const PHASE_LABEL: Record<string, string> = {
  base: "Base",
  build: "Build",
  taper: "Taper",
  race: "Race",
  recovery: "Cutback",
  offseason: "Return",
};

/** Static, phase-keyed season copy: what each block does and why it sits
 *  where it does. Presentation only — the engine's numbers are the plan. */
const PHASE_ORDER = ["offseason", "base", "build", "recovery", "taper", "race"] as const;
const PHASE_EXPLAIN: Record<(typeof PHASE_ORDER)[number], string> = {
  offseason:
    "Re-entry. Easy, mostly unstructured volume re-establishes the habit before load numbers mean anything.",
  base:
    "Raises the aerobic floor. Long, mostly easy weeks lift CTL without spiking fatigue — mitochondria, capillaries, tendon tolerance. Everything later is built on this, which is why it comes first.",
  build:
    "Converts base into race-specific fitness. Volume holds while intensity moves toward race demands, sharpening toward a peak — work that only sticks on top of an aerobic base.",
  recovery:
    "Scheduled absorption. Every few weeks load drops so the previous block's work becomes fitness. Cutbacks are planned, not earned — skipping them is how overuse starts.",
  taper:
    "Trades a little fitness for a lot of freshness. Load falls hard while intensity stays; CTL gives up a few points and form (TSB) climbs positive into race morning. The taper is protocol — the engine does not negotiate it.",
  race:
    "Protocol week. Nothing left to build, only to protect — short touches with a few race-pace efforts keep the system awake without adding fatigue.",
};

function SeasonExplainer({ phases }: { phases: Set<string> }) {
  const present = PHASE_ORDER.filter((p) => phases.has(p));
  if (present.length === 0) return null;
  return (
    <details open className="border border-hairline mb-8">
      <summary className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="label-mono text-bone-faint">How the season is built</span>
        <span className="label-mono text-bone-faint">{present.map((p) => PHASE_LABEL[p]).join(" → ")}</span>
      </summary>
      <div className="border-t border-hairline px-4 py-4 space-y-3">
        <p className="text-[13px] leading-relaxed text-bone-muted max-w-[72ch]">
          Blocks run in this order because each converts the previous one&apos;s adaptation:
          capacity first, specificity on top of it, then freshness for the day it counts.
        </p>
        {present.map((p) => (
          <div key={p} className="grid grid-cols-[80px_1fr] gap-4">
            <span className={`label-mono ${p === "taper" || p === "race" ? "text-signal-bright" : "text-bone"}`}>
              {PHASE_LABEL[p]}
            </span>
            <p className="text-[13px] leading-relaxed text-bone-muted max-w-[72ch]">{PHASE_EXPLAIN[p]}</p>
          </div>
        ))}
      </div>
    </details>
  );
}

export default async function PlanPage() {
  if (!hasCorpus()) {
    return <EmptyState title="No training data connected" body="Run the extraction pipeline (pipeline/README.md), then reload." />;
  }
  const stored = readPlan();
  if (!stored) {
    return (
      <EmptyState
        title="No active plan"
        body="Point Taper at a race and it will draft every week between now and the gun."
        cta={{ href: "/app/start", label: "Set a goal" }}
      />
    );
  }

  const { plan } = stored;
  const today = localToday();
  const maxTss = Math.max(...plan.weeks.map((w) => w.targetTss), 1);
  const raceDay = await getRaceDayPlan(plan, today);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="label-mono text-bone-muted">Season plan</p>
          <h1 className="display-engraved text-3xl mt-1">{plan.meta.raceName}</h1>
          <p className="label-mono text-bone-faint mt-2">
            {plan.meta.raceDate} · {plan.meta.raceType} · {plan.meta.daysPerWeek} days/week · engine {plan.meta.engine}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          {/* startCtl is frozen at (re)generation — label it honestly. */}
          <StatChip label="CTL at plan start" value={String(Math.round(plan.meta.startCtl))} />
          <StatChip
            label={plan.meta.projectedRaceRunCtl !== undefined ? "Race-day CTL (total)" : "Race-day CTL"}
            value={String(Math.round(plan.meta.projectedRaceCtl))}
            unit="proj."
          />
          {plan.meta.projectedRaceRunCtl !== undefined && (
            <StatChip label="Running CTL" value={String(Math.round(plan.meta.projectedRaceRunCtl))} unit="proj." />
          )}
          <StatChip label="Race-day form" value={String(Math.round(plan.meta.projectedRaceTsb))} unit="TSB" />
          <form action={replanAction}>
            <button className="label-mono bg-signal text-field px-4 py-2.5 hover:bg-bone transition-colors duration-150">
              Re-plan from today
            </button>
          </form>
        </div>
      </div>
      <div className="rule mt-5 mb-8" />

      {plan.meta.goalGap && (
        <div className="border border-hairline mb-8 p-4">
          <p className="label-mono text-bone-muted">Goal check</p>
          <p className="mt-1 text-[15px] leading-relaxed text-bone">
            {plan.meta.goalGap.goalTime} implies a race-day CTL around{" "}
            {Math.round(plan.meta.goalGap.requiredPeakCtl)}; a safe climb from ~
            {Math.round(plan.meta.startCtl)} reaches ~
            {Math.round(plan.meta.goalGap.reachablePeakCtl)} → realistic finish ~
            {plan.meta.goalGap.realisticFinish}{" "}
            <span className="text-bone-faint">(load-limited)</span>.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-bone-faint max-w-[72ch]">
            {plan.meta.goalGap.message}
          </p>
        </div>
      )}

      {plan.meta.volumeTargets && (
        <div className="border border-hairline mb-8 p-4">
          <div className="flex items-center gap-2">
            <p className="label-mono text-bone-muted">Volume targets</p>
            <EvidenceBadge id="fokkema-volume" />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
            <VolumeStat
              label="peak weekly"
              actual={plan.meta.volumeTargets.peakWeeklyKmActual}
              floor={plan.meta.volumeTargets.weeklyFloorKm}
              meets={plan.meta.volumeTargets.meetsWeeklyFloor}
            />
            <VolumeStat
              label="longest run"
              actual={plan.meta.volumeTargets.peakLongKmActual}
              floor={plan.meta.volumeTargets.longFloorKm}
              meets={plan.meta.volumeTargets.meetsLongFloor}
            />
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-bone-faint max-w-[72ch]">
            {plan.meta.volumeTargets.meetsWeeklyFloor && plan.meta.volumeTargets.meetsLongFloor
              ? "Weekly volume and long run both clear the evidence floor (weekly >32 km, long >21 km each independently linked to faster half-marathons — Fokkema 2020, observational)."
              : plan.meta.volumeTargets.tissueActive
                ? "Below the evidence floor because a tissue constraint caps running — cross-training can hold total aerobic volume while it settles."
                : "Building toward the evidence floor; the ramp needs more runway to reach it safely."}
          </p>
        </div>
      )}

      {plan.meta.tissue && plan.meta.tissue.why.length > 0 && (
        <div className="border border-hairline mb-8 p-4">
          <div className="flex items-center gap-2">
            <p className="label-mono text-signal-bright">Tissue constraint active</p>
            <EvidenceBadge id="tissue-load-management" />
          </div>
          <ul className="mt-2 space-y-1">
            {plan.meta.tissue.why.map((w) => (
              <li key={w} className="text-[13px] leading-relaxed text-bone-faint max-w-[72ch]">
                {w}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-relaxed text-bone-faint max-w-[72ch]">
            These caps apply only because a constraint is on file — a healthy runner is never
            capped prophylactically (no volume–injury link in the evidence). Cross-training can
            hold total aerobic volume while the tissue settles.
          </p>
        </div>
      )}

      {raceDay && (
        <div className="mb-8">
          <RaceDayCard plan={raceDay} raceName={plan.meta.raceName} raceDate={plan.meta.raceDate} />
        </div>
      )}

      <SeasonExplainer phases={new Set(plan.weeks.map((w) => w.phase))} />

      <div className="space-y-3">
        {plan.weeks.map((w) => {
          const isCurrent = today >= w.weekStart && today < addDays(w.weekStart, 7);
          return (
            <details key={w.weekStart} open={isCurrent} className="border border-hairline">
              <summary className="flex items-center gap-4 px-4 py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <span className="label-mono text-bone-faint w-20 shrink-0">wk {w.weekStart.slice(5)}</span>
                <span className={`label-mono w-16 shrink-0 ${w.phase === "taper" || w.phase === "race" ? "text-signal-bright" : "text-bone-muted"}`}>
                  {PHASE_LABEL[w.phase]}
                </span>
                <span className="grow h-[6px] bg-field-sunken relative" aria-hidden="true">
                  <span
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${(w.targetTss / maxTss) * 100}%`, background: w.phase === "taper" || w.phase === "race" ? "var(--signal)" : "var(--bone-faint)" }}
                  />
                </span>
                <span className="font-mono text-sm tabular text-bone-muted w-24 text-right shrink-0">{w.targetTss} TSS</span>
                <span className="label-mono text-bone-faint w-28 text-right shrink-0 hidden md:inline">
                  CTL {Math.round(w.projected.ctl)} · TSB {Math.round(w.projected.tsb)}
                </span>
              </summary>
              <div className="border-t border-hairline p-3 space-y-2">
                {weekIntensity(w) && <IntensityStrip dist={weekIntensity(w)!} phase={w.phase} />}
                {w.sessions.map((s) => (
                  <SessionCard key={s.date + s.title} s={s} compact={!isCurrent} />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

/** Confidence-tier badge for a prescriptive claim (feature 6). Hovering shows
 *  the plain claim + source, so the copy never implies more certainty than the
 *  evidence holds. Renders nothing for an unknown id. */
function EvidenceBadge({ id }: { id: string }) {
  const e = evidenceFor(id);
  if (!e) return null;
  // Focusable (tabIndex) with the claim in an aria-label, so keyboard and
  // screen-reader users reach the evidence — the point of the feature — not
  // just mouse-hoverers reading the title tooltip.
  return (
    <span
      tabIndex={0}
      className={`label-mono ${TIER_TONE[e.tier]} border border-hairline px-1.5 py-0.5 focus:border-bone outline-none`}
      title={`${e.plainClaim} — ${e.source}`}
      aria-label={`Evidence tier: ${TIER_LABEL[e.tier]}. ${e.plainClaim} Source: ${e.source}`}
    >
      {TIER_LABEL[e.tier]}
    </span>
  );
}

/** One volume target: achieved km vs the evidence floor (feature 2). */
function VolumeStat({ label, actual, floor, meets }: { label: string; actual: number; floor: number; meets: boolean }) {
  return (
    <div>
      <p className="label-mono text-bone-faint">{label}</p>
      <p className="mt-0.5 font-mono text-lg tabular text-bone">
        {Math.round(actual)}<span className="text-bone-faint text-sm"> km</span>
      </p>
      <p className={`label-mono ${meets ? "text-bone-muted" : "text-signal-bright"}`}>
        {meets ? "≥" : "below"} {floor} km floor
      </p>
    </div>
  );
}

/** Time-in-zone strip for a plan week (feature 1). Shows the actual easy /
 *  moderate / hard split by TIME — the training variable TSS is blind to — and
 *  brackets it against the phase target. Base/build ride the elite ~88–92%
 *  easy band; race-specific weeks earn more hard time. */
function IntensityStrip({ dist, phase }: { dist: WeekIntensity; phase: string }) {
  const seg = [
    { pct: dist.z1, color: "var(--bone-faint)", label: "easy" },
    { pct: dist.z2, color: "var(--bone-muted)", label: "moderate" },
    { pct: dist.z3, color: "var(--signal)", label: "hard" },
  ].filter((s) => s.pct > 0);
  const note =
    phase === "base" || phase === "build" || phase === "recovery"
      ? dist.elite
        ? `${dist.z1}% easy — elite aerobic band`
        : `${dist.z1}% easy (target ~${dist.targetZ1}%)`
      : `${dist.z1}% easy — race-specific sharpening`;
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="label-mono text-bone-faint flex items-center gap-2">
          intensity by time <EvidenceBadge id="intensity-distribution" />
        </span>
        <span className="label-mono text-bone-muted">{note}</span>
      </div>
      <div className="flex h-[6px] w-full overflow-hidden bg-field-sunken" aria-hidden="true">
        {seg.map((s) => (
          <span key={s.label} style={{ width: `${s.pct}%`, background: s.color }} title={`${s.pct}% ${s.label}`} />
        ))}
      </div>
      <div className="flex gap-4 mt-1">
        {seg.map((s) => (
          <span key={s.label} className="label-mono text-bone-faint flex items-center gap-1">
            <span className="inline-block w-2 h-2" style={{ background: s.color }} aria-hidden="true" />
            {s.pct}% {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Pure date-string math (input is already a calendar date, so UTC-anchored
// arithmetic is exact) — formatted without toISOString so the taper-rules
// grep for UTC "today" derivations stays clean.
function addDays(d: string, n: number): string {
  const t = new Date(Date.parse(d + "T12:00:00Z") + n * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(t);
}
