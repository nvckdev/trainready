import { getAthlete, getPmc, getWeekly, hasCorpus, localToday } from "@/lib/athlete-data";
import { readAthleteContext } from "@/lib/athlete-context";
import { readPainLog, readProtocolsState } from "@/lib/strength-io";
import { strengthTssPerSession } from "@/lib/strength-protocols";
import { SEED_PROTOCOLS } from "@/lib/strength-seed";
import { weeklyPainAverages } from "@/lib/pain-rules";
import { addDays, mondayOf } from "@/lib/strength-schedule";
import { PainVsLoadChart, PmcChart, WeeklyVolumeChart, type PainLoadRow } from "@/components/app/charts";
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

  // Pain vs load — pain log read through the strength-io gateway (health
  // data, gitignored). Weekly TSS comes from the derived corpus; weeks past
  // the last derived row (pain logged since the last extraction) carry a
  // null TSS rather than a false zero. Section renders only once the
  // athlete has logged pain.
  const painEntries = readPainLog();
  let painRows: PainLoadRow[] = [];
  if (painEntries.length > 0 && weekly.length > 0) {
    const rows: PainLoadRow[] = weekly.map((w) => ({ weekStart: w.weekStart, tss: w.tss, pain: null }));
    const today = localToday();
    for (let next = addDays(rows[rows.length - 1].weekStart, 7); next <= today; next = addDays(next, 7)) {
      rows.push({ weekStart: next, tss: null, pain: null });
    }
    painRows = rows.slice(-12);
    const avgs = weeklyPainAverages(painEntries, painRows.map((r) => r.weekStart));
    painRows.forEach((r, i) => (r.pain = avgs[i]));
  }

  // Strength in the weekly bars (docs §6) — DISPLAY ONLY. Completed
  // non-rehab strength sessions (protocols-state.json, gitignored) add a
  // fixed per-session TSS into the "other" stack segment; rehab work is
  // therapeutic dose, not training stress. The derived corpus, PMC rows,
  // and the engine are untouched — this recolors bars, nothing upstream.
  const strengthTssPer = strengthTssPerSession(readAthleteContext());
  const strengthByWeek = new Map<string, number>();
  for (const c of readProtocolsState()?.completions ?? []) {
    const protocol = SEED_PROTOCOLS.find((p) => p.id === c.protocolId);
    if (!protocol || protocol.rehab) continue;
    const ws = mondayOf(c.date);
    strengthByWeek.set(ws, (strengthByWeek.get(ws) ?? 0) + strengthTssPer);
  }
  const strengthTotal = [...strengthByWeek.values()].reduce((a, b) => a + b, 0);
  let volumeRows = weekly;
  if (strengthTotal > 0 && weekly.length > 0) {
    const rows = weekly.map((w) => ({ ...w }));
    // Completions can postdate the last corpus extraction — extend with
    // zero-load weeks up to today so current strength work still shows.
    const today = localToday();
    for (let next = addDays(rows[rows.length - 1].weekStart, 7); next <= today; next = addDays(next, 7)) {
      rows.push({ weekStart: next, tss: 0, hours: 0, swim: 0, bike: 0, run: 0, other: 0 });
    }
    for (const r of rows) {
      const add = strengthByWeek.get(r.weekStart);
      if (add) {
        r.other += add;
        r.tss += add;
      }
    }
    volumeRows = rows;
  }

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
        <WeeklyVolumeChart rows={volumeRows} otherLabel={strengthTotal > 0 ? "other / strength" : "other"} />
        {strengthTotal > 0 && (
          <p className="text-[13px] text-bone-muted leading-relaxed mt-3 max-w-[68ch]">
            Completed strength sessions count {strengthTssPer} TSS each here (set on the intake
            form) and stack into the other/strength segment — display only: CTL, ATL, TSB, and
            the plan engine never see strength load.
          </p>
        )}
      </section>

      {painRows.length > 0 && (
        <section className="mt-12">
          <h2 className="label-mono text-bone-muted mb-4">Pain vs load · last 12 weeks</h2>
          <PainVsLoadChart rows={painRows} />
          <p className="text-[13px] text-bone-muted leading-relaxed mt-3 max-w-[68ch]">
            Pain is your daily check-in from the Today page, averaged per week
            (0–10 NRS). If the rose line climbs while the bars climb, the load
            is outrunning the tissue — ease intensity first. Weeks without a
            bar postdate the last corpus extraction; weeks without a point had
            no pain logged. Advisory only: none of this feeds the plan engine.
          </p>
        </section>
      )}

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
