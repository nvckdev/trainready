import { syncWindow } from "./sync-window";
import { sinceForSync } from "../../engine/connector.ts";
import { gapEvidenceFrom } from "./fitness-evidence";
import type { Plan } from "../../engine/plan.ts";

/**
 * The two remaining pure extractions of the wiring-test contract:
 * sync-io's window/retention decision and fitness-evidence's gap evidence.
 * Their engine primitives are pinned (C8/C9 for the window, the seed tests
 * for the gap loop) — these pin the CALL-SITE wiring, which the engine tests
 * deliberately hold byte-identical when unwired.
 *
 * KILL-RUNS (verified once each):
 *   - hardcoding pruneBefore to the 120-day default → W1c/W1d fail
 *   - dropping the coverage argument from gapEvidenceFrom's covered() → G1d
 *     fails
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const TODAY = "2026-08-06T09:00:00.000Z";

// ——— W1. the sync window ———————————————————————————————————————————————————
{
  const withPlan = syncWindow("2026-01-05", TODAY);
  check("W1a", "since reaches the plan's first week (E10) — the engine's own rule, threaded",
    withPlan.since === sinceForSync("2026-01-05", TODAY), `${withPlan.since}`);
  check("W1b", "…which for an old plan start is before it, never the 120-day default",
    withPlan.since <= "2026-01-05", withPlan.since);
  check("W1c", "retention keeps a month of pre-plan margin", withPlan.pruneBefore === "2025-12-06", String(withPlan.pruneBefore));
  const noPlan = syncWindow(undefined, TODAY);
  check("W1d", "no plan ⇒ NO prune — erasing to a default window is the E10 bug in miniature",
    noPlan.pruneBefore === undefined, String(noPlan.pruneBefore));
  check("W1e", "…while since still gets the engine default", noPlan.since === sinceForSync(undefined, TODAY));
}

// ——— G1. gap evidence from explicit inputs —————————————————————————————————
{
  const plan = {
    weeks: [{
      weekStart: "2026-08-03",
      sessions: [
        { date: "2026-08-03", discipline: "run", tss: 70, status: "done" },
        { date: "2026-08-04", discipline: "run", tss: 60 }, // untapped: proves nothing
      ],
    }],
  } as unknown as Plan;
  const activities: Parameters<typeof gapEvidenceFrom>[1] = [
    { source: "file", sport: "run", startTime: "2026-08-03T10:30:00Z", distanceM: null, durationS: 3600, movingTimeS: null, tss: 80 } as Parameters<typeof gapEvidenceFrom>[1][number],
  ];
  const coverage: Parameters<typeof gapEvidenceFrom>[2] = [{ source: "strava", from: "2026-08-01", to: "2026-08-05" }];
  const localDate = (iso: string) => iso.slice(0, 10);

  const g = gapEvidenceFrom(plan, activities, coverage, {}, localDate);
  check("G1a", "a done-mark day carries load", (g.load.get("2026-08-03") ?? 0) > 0, String(g.load.get("2026-08-03")));
  check("G1b", "an untapped scheduled day carries NO load — a tap that never happened proves nothing",
    g.load.get("2026-08-04") === undefined, String(g.load.get("2026-08-04")));
  check("G1c", "a tapped session and its imported twin never double-count (max, not sum)",
    (g.load.get("2026-08-03") ?? 0) <= 80 + 1e-9, String(g.load.get("2026-08-03")));
  check("G1d", "covered() answers from the COVERAGE windows passed in", g.covered!("2026-08-02") === true && g.covered!("2026-08-09") === false);
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nsync-window+gap-evidence: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
