import { getPmc, hasCorpus } from "@/lib/athlete-data";
import { readPlan } from "@/lib/plan-io";
import { EmptyState, SessionCard, StatChip } from "@/components/app/bits";

export const dynamic = "force-dynamic";

export default function TodayPage() {
  if (!hasCorpus()) {
    return (
      <EmptyState
        title="No training data connected"
        body="Taper reads your history from the local corpus (data/). Run the extraction pipeline described in pipeline/README.md, then reload."
      />
    );
  }

  const pmc = getPmc();
  const latest = pmc[pmc.length - 1];
  const stored = readPlan();
  const today = new Date().toISOString().slice(0, 10);

  const upcoming = stored
    ? stored.plan.weeks
        .flatMap((w) => w.sessions)
        .filter((s) => s.date >= today)
        .slice(0, 4)
    : [];
  const [next, ...rest] = upcoming;
  const daysToRace = stored
    ? Math.max(0, Math.round((Date.parse(stored.plan.meta.raceDate) - Date.parse(today)) / 86400000))
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h1 className="display-engraved text-3xl">Today</h1>
        <div className="flex gap-6">
          <StatChip label="Fitness" value={String(Math.round(latest?.ctl ?? 0))} unit="CTL" />
          <StatChip label="Fatigue" value={String(Math.round(latest?.atl ?? 0))} unit="ATL" />
          <StatChip label="Form" value={String(Math.round(latest?.tsb ?? 0))} unit="TSB" />
          {daysToRace !== null && <StatChip label="Race in" value={String(daysToRace)} unit="days" />}
        </div>
      </div>
      <div className="rule mt-5 mb-8" />

      {!stored ? (
        <EmptyState
          title="No active plan"
          body="Point Taper at a race and it will draft the season from your current fitness."
          cta={{ href: "/app/start", label: "Set a goal" }}
        />
      ) : !next ? (
        <EmptyState
          title="Season complete"
          body="Every planned session is behind you. Set the next goal when you're ready."
          cta={{ href: "/app/start", label: "New goal" }}
        />
      ) : (
        <div className="space-y-8">
          <div>
            <p className="label-mono text-bone-muted mb-3">
              {next.date === today ? "Today's session" : `Next session · ${next.weekday} ${next.date.slice(5)}`}
            </p>
            <SessionCard s={next} />
          </div>
          {rest.length > 0 && (
            <div>
              <p className="label-mono text-bone-muted mb-3">Then</p>
              <div className="space-y-2">
                {rest.map((s) => (
                  <SessionCard key={s.date + s.title} s={s} compact />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
