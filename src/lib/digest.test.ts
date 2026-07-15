/**
 * Weekly-digest tests. The digest lives in src/lib (app layer), but its logic
 * is pure and worth pinning here in the engine test harness style. Imports the
 * app module directly — deterministic string assembly over typed inputs.
 */
import { weeklyDigest } from "./digest.ts";
import type { Plan } from "../../engine/plan.ts";

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// n sequential daily rows ending 2026-07-14 (day before the test's "today"),
// so the date-based 28-day delta has real dates to reach back into.
const pmc = (n: number, startCtl: number, endCtl: number, tsb: number) =>
  Array.from({ length: n }, (_, i) => {
    const ctl = startCtl + ((endCtl - startCtl) * i) / (n - 1);
    const d = new Date("2026-07-14T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return { date: d.toISOString().slice(0, 10), tss: 50, ctl, atl: ctl - tsb, tsb };
  });

const plan = (over: Partial<Plan["meta"]> = {}): Plan => ({
  meta: {
    generatedAt: "2026-07-13", engine: "taper-v1", raceName: "Test Half", raceDate: "2026-10-18",
    raceType: "run-half", daysPerWeek: 6, longDay: "sunday", startCtl: 17,
    projectedRaceCtl: 22, projectedRaceTsb: 6, ...over,
  },
  weeks: [
    { weekStart: "2026-07-06", phase: "base", targetTss: 120, projected: { ctl: 17, atl: 20, tsb: -3 }, sessions: [] },
    { weekStart: "2026-07-13", phase: "build", targetTss: 140, projected: { ctl: 18, atl: 24, tsb: -6 }, sessions: [] },
  ],
});
const weekly = [{ weekStart: "2026-07-06", tss: 138, hours: 4, swim: 0, bike: 0, run: 138, other: 0 }];

// D1 — assembles lines grounded in the data
{
  const d = weeklyDigest(pmc(30, 14, 18, -4), weekly, plan(), "2026-07-15");
  check("D1a", "returns a digest with a headline + lines", !!d && d.lines.length >= 3);
  check("D1b", "reports last week executed vs target (138 vs 120 ⇒ over)",
    !!d && d.lines.some((l) => l.includes("138") && /over plan/.test(l)));
  check("D1c", "reports current week phase + target", !!d && d.lines.some((l) => /build/.test(l) && l.includes("140")));
  check("D1d", "CTL trend reads 'up' when fitness rose 14→18", !!d && d.lines.some((l) => /up 4/.test(l)));
}

// D2 — replan note surfaces as the honest flag
{
  const d = weeklyDigest(pmc(30, 17, 18, -4), weekly, plan({ replanNote: "last week +18% over target → eased" }), "2026-07-15");
  check("D2", "plan replanNote surfaces as a heads-up line", !!d && d.lines.some((l) => /Heads up/.test(l) && /eased/.test(l)));
}

// D3 — taper headline
{
  const p = plan();
  p.weeks[1].phase = "taper";
  const d = weeklyDigest(pmc(30, 20, 20, 5), weekly, p, "2026-07-15");
  check("D3", "taper week ⇒ 'trust the taper' headline", !!d && /trust the taper/i.test(d.headline));
}

// D4 — null-safe
{
  check("D4a", "no plan ⇒ null", weeklyDigest(pmc(5, 15, 15, 0), weekly, null, "2026-07-15") === null);
  check("D4b", "no pmc ⇒ null", weeklyDigest([], weekly, plan(), "2026-07-15") === null);
}

// D5 — the rolled-forward `current` state wins over the stale last row
{
  // Last logged row is CTL 21; today's rolled-forward state is CTL 16. The
  // headline must report 16 (matching the Today/Fitness headers), not 21.
  const d = weeklyDigest(pmc(30, 18, 21, -3), weekly, plan(), "2026-07-15", { ctl: 16, tsb: 12 });
  check("D5", "headline uses rolled-forward CTL 16, not the stale last row 21",
    !!d && d.lines.some((l) => l.includes("CTL 16")) && !d.lines.some((l) => l.includes("CTL 21")),
    d?.lines.find((l) => /CTL/.test(l)));
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.log("  " + f);
console.log(`\ndigest: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
