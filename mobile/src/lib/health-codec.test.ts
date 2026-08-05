import { decodeDeclarations, decodePainLog, encodeDeclarations, encodePainLog } from "./health-codec";
import { surfaceAlerts, type PainEntry } from "../../engine/pain.ts";
import { activeDeclarations, toConstraint } from "../../engine/tissue-declare.ts";

/**
 * The phone's health-data codec — what turns stored bytes back into caps and
 * alerts.
 *
 * Runs under tsx from the repo root: health-codec.ts imports only engine
 * modules, so nothing pulls AsyncStorage or react-native in. The stores are
 * deliberately thin around this for exactly that reason.
 *
 * The two payloads are decoded with OPPOSITE discipline and both directions
 * are pinned here, because getting either backwards is a real injury:
 *
 *   pain log     — filter bad rows, KEEP the series (a corrupt row costs one
 *                  data point; discarding months of log costs the rules their
 *                  history)
 *   declarations — refuse the WHOLE read on one bad entry (a dropped row costs
 *                  an injury cap that silently stops binding — E9's failure)
 *
 * It also pins the cross-surface claim the feature rests on: the same bytes
 * must produce the same alerts and the same caps on the phone as on the
 * dashboard, since both now route through the same engine functions.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const entry = (date: string, score: number, context: PainEntry["context"] = "after-session"): PainEntry => ({
  date,
  region: "calf-achilles",
  score0to10: score,
  context,
});

// ——— H1. pain log: round-trips, and survives damage ————————————————————————
{
  const log = [entry("2026-08-03", 4), entry("2026-08-05", 6, "at-rest")];
  const back = decodePainLog(encodePainLog(log));
  check("H1a", "a pain log round-trips through storage byte-for-byte",
    JSON.stringify(back) === JSON.stringify(log), JSON.stringify(back));
  check("H1b", "absent storage is an empty log, not a crash", decodePainLog(null).length === 0);
  check("H1c", "unparseable storage is an empty log — a corrupt cache must never stop today's entry",
    decodePainLog("{not json").length === 0);

  // The asymmetry: FILTER, do not refuse.
  const damaged = JSON.stringify({
    entries: [entry("2026-08-03", 4), { date: "2026-08-04", region: "elbow", score0to10: 5, context: "at-rest" }, entry("2026-08-05", 6)],
  });
  const kept = decodePainLog(damaged);
  check("H1d", "one corrupt row is dropped and the rest of the series survives",
    kept.length === 2 && kept.every((e) => e.region === "calf-achilles"), JSON.stringify(kept.map((e) => e.date)));
  check("H1e", "the decoded series is date-ordered whatever order it was stored in",
    JSON.stringify(decodePainLog(JSON.stringify({ entries: [entry("2026-08-05", 1), entry("2026-08-01", 2)] })).map((e) => e.date))
      === JSON.stringify(["2026-08-01", "2026-08-05"]));
}

// ——— H2. …and the alerts it feeds are the dashboard's ————————————————————
{
  const stored = encodePainLog([entry("2026-08-03", 5), entry("2026-08-04", 5), entry("2026-08-05", 5)]);
  const alerts = surfaceAlerts(decodePainLog(stored), "2026-08-05");
  check("H2a", "a phone-stored log raises the same consecutive alert the dashboard would",
    alerts.length === 1 && alerts[0].rule === "consecutive", alerts.map((a) => a.rule).join(","));
}

// ——— H3. declarations: refuse, never partially accept ————————————————————
{
  const good = [
    { site: "calf", status: "tendinopathy", provocation: "impact", declaredOn: "2026-08-01", resolvedOn: null },
  ];
  const ok = decodeDeclarations(encodeDeclarations(good));
  check("H3a", "a good declaration store parses", ok.status === "ok" && ok.declarations.length === 1, ok.status);
  check("H3b", "absent storage is ABSENT — no injuries on file, the plan proceeds uncapped",
    decodeDeclarations(null).status === "absent");
  check("H3c", "unparseable storage is UNREADABLE, never absent — caps that cannot be read are not caps that are gone",
    decodeDeclarations("{not json").status === "unreadable");

  const mixed = encodeDeclarations([...good, { site: "elbow", status: "acute", provocation: "impact", declaredOn: "2026-08-02", resolvedOn: null }]);
  const refused = decodeDeclarations(mixed);
  check("H3d", "one bad entry refuses the WHOLE store — a partial safety file is not a safety file",
    refused.status === "unreadable" && refused.declarations.length === 0,
    `${refused.status}/${refused.declarations.length}`);
}

// ——— H4. …and a phone declaration binds the caps the athlete was shown ————
{
  const stored = encodeDeclarations([
    { site: "shin", status: "acute", provocation: "volume", declaredOn: "2026-08-01", resolvedOn: null, note: "after the 20k" },
  ]);
  const read = decodeDeclarations(stored);
  const active = activeDeclarations(read.declarations, "2026-08-05");
  const c = active.length === 1 ? toConstraint(active[0]) : null;
  check("H4a", "a phone-declared constraint publishes the engine's own caps",
    c?.caps.weeklyKm === 24 && c?.caps.longRunKm === 16 && c?.caps.rampCeiling === 1.05,
    JSON.stringify(c?.caps));
  check("H4b", "…carrying the athlete's own words as the why", /20k/.test(c?.why ?? ""), c?.why ?? "");
  const healed = decodeDeclarations(
    encodeDeclarations([{ site: "shin", status: "acute", provocation: "volume", declaredOn: "2026-08-01", resolvedOn: "2026-08-03" }])
  );
  check("H4c", "a resolved declaration stops binding",
    activeDeclarations(healed.declarations, "2026-08-05").length === 0);
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nhealth-codec: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
