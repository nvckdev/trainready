import { gapEvidence } from "@/lib/fitness-evidence";
import { readPlan } from "@/lib/plan-io";
import {
  getAthlete,
  getIntervalsActivities,
  getStateAt,
  intervalsConfigured,
  localToday,
  readImports,
} from "@/lib/athlete-data";
import { DISC_COLOR, EmptyState, StatChip } from "@/components/app/bits";
import { PairPhone } from "@/components/app/pair-phone";
import { readSyncStore } from "@/lib/sync-io";
import { syncActivitiesAction } from "../actions";
import { loadPopulationPrior } from "../../../../engine/learned.ts";

/** `TAPER1.` + base64url(JSON) — decoded by the mobile app's Settings screen. */
function pairCode(): string | null {
  const athlete = getAthlete();
  // The phone inherits this seed — it must be the same truest state the
  // dashboard itself plans from (E8), not a zero-rolled stale corpus tail.
  const seed = getStateAt(localToday(), gapEvidence(readPlan()?.plan ?? null));
  if (!athlete || !seed) return null;
  const payload = {
    v: 1,
    name: athlete.name,
    thresholds: athlete.thresholds,
    seed,
    anchor: localToday(),
    // The athlete's clock — one definition of "today" on both surfaces (M3).
    tz: "America/New_York",
    // Refinement 2 parity: the phone has no data/models artifact, so the
    // population prior rides the pairing code (null → field absent).
    ...(loadPopulationPrior() ? { prior: loadPopulationPrior() } : {}),
  };
  return "TAPER1." + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export const dynamic = "force-dynamic";

const SHOW_MAX = 30;

function fmtDuration(hr: number): string {
  const min = Math.round(hr * 60);
  return min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min}m`;
}

export default async function ImportPage() {
  const store = readImports();
  const synced = await getIntervalsActivities();
  // Dedupe by (date, sport, rounded duration) before totalling — the raw
  // concat double-counted any session present in both the file store and
  // intervals.icu.
  const seen = new Set<string>();
  const all = [...store.activities, ...synced]
    .filter((a) => {
      const k = `${a.date}|${a.sport}|${Math.round(a.durationHr * 60)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const recent = all.slice(0, SHOW_MAX);
  const totalTss = all.reduce((s, a) => s + a.tssEst, 0);
  const batch = store.lastBatch;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <h1 className="display-engraved text-3xl">Import</h1>
        {all.length > 0 && (
          <div className="flex gap-6">
            <StatChip label="Activities" value={String(all.length)} />
            <StatChip label="Total load" value={String(Math.round(totalTss))} unit="TSS est" />
          </div>
        )}
      </div>
      <div className="rule mt-5 mb-8" />

      <div className="grid md:grid-cols-[minmax(0,380px)_1fr] gap-8 items-start">
        <div className="space-y-6">
          <form
            action="/api/import"
            method="post"
            encType="multipart/form-data"
            className="border border-hairline"
          >
            <div className="px-4 py-3 border-b border-hairline">
              <span className="label-mono text-bone-faint">Upload activity files</span>
            </div>
            <div className="px-4 py-4 space-y-4">
              <p className="text-[13px] leading-relaxed text-bone-muted">
                FIT, TCX, or GPX — straight off the watch or exported from any
                platform. Load is estimated from duration and sport, and always
                labeled an estimate.
              </p>
              <input
                type="file"
                name="files"
                multiple
                required
                accept=".fit,.tcx,.gpx"
                className="block w-full font-mono text-sm text-bone-muted file:label-mono file:bg-field-sunken file:text-bone file:border file:border-hairline file:px-4 file:py-2.5 file:mr-4 file:cursor-pointer"
              />
              <button className="label-mono bg-signal text-field px-6 py-3 hover:bg-bone transition-colors duration-150">
                Import files
              </button>
            </div>
          </form>

          {batch && (
            <div className="border border-hairline">
              <div className="px-4 py-3 border-b border-hairline">
                <span className="label-mono text-bone-faint">Last import</span>
              </div>
              <div className="px-4 py-4">
                <p className="font-mono text-sm tabular text-bone">
                  {batch.imported} imported · {batch.duplicates} duplicate
                  {batch.duplicates === 1 ? "" : "s"} · {batch.files} file
                  {batch.files === 1 ? "" : "s"}
                </p>
                {batch.errors.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {batch.errors.map((e, i) => (
                      <li key={i} className="text-[12.5px] leading-relaxed text-bone-muted">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {(() => {
            const sync = readSyncStore();
            return (
              <div className="border border-hairline">
                <div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
                  <span className="label-mono text-bone-faint">Connected sources</span>
                  <form action={syncActivitiesAction}>
                    <button className="label-mono text-[10px] border border-hairline px-2 py-1 text-bone hover:border-bone-faint">
                      Sync now
                    </button>
                  </form>
                </div>
                <div className="px-4 py-4 space-y-3">
                  {sync.sources.length === 0 && (
                    <p className="text-[13px] leading-relaxed text-bone-muted">
                      No sync has run yet. Sync now pulls recent activities from every connected
                      source and deduplicates them, so a run pushed to several platforms counts once.
                    </p>
                  )}
                  {sync.sources.map((src) => (
                    <div key={src.source} className="flex items-baseline justify-between gap-4">
                      <div className="min-w-0">
                        <span className="font-mono text-[12.5px] text-bone">{src.label}</span>
                        {src.message && (
                          <p className="text-[12.5px] leading-relaxed text-signal-bright">{src.message}</p>
                        )}
                      </div>
                      <span className="label-mono text-[10px] text-bone-faint whitespace-nowrap">
                        {src.status === "ok"
                          ? `${src.activityCount} · synced ${String(src.lastSyncedAt ?? "").slice(0, 10)}`
                          : src.status.toUpperCase()}
                      </span>
                    </div>
                  ))}
                  {sync.sources.some((s2) => s2.status !== "ok" && s2.status !== "not-configured") && (
                    <p className="text-[12.5px] leading-relaxed text-bone-muted">
                      A source that failed is reported as unknown, never as a week without training —
                      the plan will not adapt on missing data.
                    </p>
                  )}
                </div>
              </div>
            );
          })()}

          {(() => {
            const code = pairCode();
            return code ? <PairPhone code={code} /> : null;
          })()}

          <div className="border border-hairline px-4 py-4">
            <div className="label-mono text-bone-faint mb-1.5">intervals.icu sync</div>
            <p className="text-[12.5px] leading-relaxed text-bone-muted">
              {intervalsConfigured()
                ? `Active — recent activities are pulled from intervals.icu on each load (${synced.length} in the last 42 days).`
                : "Set INTERVALS_ICU_API_KEY and INTERVALS_ICU_ATHLETE_ID in the environment and recent activities sync here automatically — no upload needed."}
            </p>
          </div>
        </div>

        {all.length === 0 ? (
          <EmptyState
            title="No imported activities"
            body="Upload FIT, TCX, or GPX files and each session lands here with its date, sport, duration, and an estimated load."
          />
        ) : (
          <div className="border border-hairline overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-hairline">
              <span className="label-mono text-bone-faint">Imported activities</span>
              {all.length > SHOW_MAX && (
                <span className="label-mono text-bone-faint">
                  latest {SHOW_MAX} of {all.length}
                </span>
              )}
            </div>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-hairline">
                  {["Date", "Sport", "Duration", "Distance", "Avg HR", "Load", "Source"].map((h) => (
                    <th key={h} className="label-mono text-bone-faint font-normal px-4 py-2.5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((a) => (
                  <tr key={a.id + a.source} className="border-b border-hairline last:border-b-0">
                    <td className="font-mono text-sm tabular text-bone px-4 py-2.5">{a.date}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: DISC_COLOR[a.sport] ?? "var(--bone-faint)" }}
                          aria-hidden="true"
                        />
                        <span className="text-[13px] text-bone-muted">{a.sport}</span>
                      </span>
                    </td>
                    <td className="font-mono text-sm tabular text-bone-muted px-4 py-2.5">
                      {fmtDuration(a.durationHr)}
                    </td>
                    <td className="font-mono text-sm tabular text-bone-muted px-4 py-2.5">
                      {a.distanceKm != null ? `${a.distanceKm.toFixed(1)} km` : "—"}
                    </td>
                    <td className="font-mono text-sm tabular text-bone-muted px-4 py-2.5">
                      {a.avgHr != null ? a.avgHr : "—"}
                    </td>
                    <td className="font-mono text-sm tabular text-bone-muted px-4 py-2.5">
                      {Math.round(a.tssEst)} <span className="label-mono text-bone-faint">est</span>
                    </td>
                    <td className="label-mono text-bone-faint px-4 py-2.5">{a.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
