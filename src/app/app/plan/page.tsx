import { hasCorpus, localToday } from "@/lib/athlete-data";
import { readPlan } from "@/lib/plan-io";
import { EmptyState, SessionCard, StatChip } from "@/components/app/bits";
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

export default function PlanPage() {
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
        <div className="flex items-end gap-6">
          <StatChip label="CTL now" value={String(Math.round(plan.meta.startCtl))} />
          <StatChip label="Race-day CTL" value={String(Math.round(plan.meta.projectedRaceCtl))} unit="proj." />
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

// Pure date-string math (input is already a calendar date, so UTC-anchored
// arithmetic is exact) — formatted without toISOString so the taper-rules
// grep for UTC "today" derivations stays clean.
function addDays(d: string, n: number): string {
  const t = new Date(Date.parse(d + "T12:00:00Z") + n * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(t);
}
