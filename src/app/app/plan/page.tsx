import { hasCorpus } from "@/lib/athlete-data";
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
  const today = new Date().toISOString().slice(0, 10);
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

function addDays(d: string, n: number): string {
  return new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}
