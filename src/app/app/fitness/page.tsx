import { getAthlete, getPmc, getWeekly, hasCorpus } from "@/lib/athlete-data";
import { PmcChart, WeeklyVolumeChart } from "@/components/app/charts";
import { EmptyState, StatChip } from "@/components/app/bits";

export const dynamic = "force-dynamic";

export default function FitnessPage() {
  if (!hasCorpus()) {
    return <EmptyState title="No training data connected" body="Run the extraction pipeline (pipeline/README.md), then reload." />;
  }
  const pmc = getPmc();
  const weekly = getWeekly();
  const athlete = getAthlete();
  const latest = pmc[pmc.length - 1];
  const last4 = weekly.slice(-4);
  const avgHours = last4.reduce((s, w) => s + w.hours, 0) / Math.max(1, last4.length);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h1 className="display-engraved text-3xl">Fitness</h1>
        <div className="flex gap-6">
          <StatChip label="Fitness" value={String(Math.round(latest.ctl))} unit="CTL" />
          <StatChip label="Form" value={String(Math.round(latest.tsb))} unit="TSB" />
          <StatChip label="Last 4 wks" value={avgHours.toFixed(1)} unit="h/wk" />
          {athlete && <StatChip label="FTP" value={String(athlete.thresholds.ftpWatts)} unit="W" />}
        </div>
      </div>
      <div className="rule mt-5 mb-8" />

      <section className="mb-12">
        <h2 className="label-mono text-bone-muted mb-4">Load, fatigue, and form · full history</h2>
        <PmcChart rows={pmc} />
        <p className="text-[13px] text-bone-muted leading-relaxed mt-3 max-w-[68ch]">
          This is why your plan looks the way it does: prescriptions push fitness
          (orange) upward at a rate your fatigue (blue) can absorb, then trade a
          little fitness for a lot of freshness (gold) when a race approaches.
        </p>
      </section>

      <section>
        <h2 className="label-mono text-bone-muted mb-4">Weekly load by discipline · last 52 weeks</h2>
        <WeeklyVolumeChart rows={weekly} />
      </section>

      {athlete && (
        <section className="mt-12">
          <h2 className="label-mono text-bone-muted mb-4">Current zones</h2>
          <div className="grid md:grid-cols-3 gap-px bg-hairline border border-hairline">
            {(
              [
                ["Run", [["Easy", athlete.zones.run.easy], ["Tempo", athlete.zones.run.tempo], ["Threshold", athlete.zones.run.threshold], ["VO2", athlete.zones.run.vo2]]],
                ["Bike", [["Zone 2", athlete.zones.bike.z2], ["Tempo", athlete.zones.bike.tempo], ["Threshold", athlete.zones.bike.threshold], ["VO2", athlete.zones.bike.vo2]]],
                ["Swim", [["Easy", athlete.zones.swim.easy], ["CSS", athlete.zones.swim.threshold], ["VO2", athlete.zones.swim.vo2]]],
              ] as const
            ).map(([sport, rows]) => (
              <div key={sport} className="bg-field p-5">
                <h3 className="font-semibold mb-3">{sport}</h3>
                <dl className="space-y-2">
                  {rows.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt className="label-mono text-bone-faint">{k}</dt>
                      <dd className="font-mono text-sm tabular text-bone-muted">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
