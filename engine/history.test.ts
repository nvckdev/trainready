import { generatePlan, type PlanRequest } from "./plan.ts";
import { deriveZones } from "./zones.ts";
import { TaperV1 } from "./learned.ts";
import type { AthleteState } from "./types.ts";
import { deriveBaseRichness, rampCapFromRichness } from "./history.ts";

/**
 * Base-richness / de-novo ramp tests (feature 3). tsx harness; exit = fails.
 * The headline (H5): a returning athlete with a big historical CTL peak reaches
 * a HIGHER safe peak CTL over the same window than a de-novo athlete at the
 * identical current CTL — because their safe ramp is faster (detraining research).
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const wk = (ctl: number, i: number): { state: AthleteState; actualTss: number; weekStart?: string } => ({
  state: {
    ctl, atl: ctl, tsb: 0, last4WeeksTss: [ctl * 7, ctl * 7, ctl * 7, ctl * 7],
    last4Shares: { swim: 0, bike: 0, run: 1 }, daysToNextRace: null, weeksSinceStart: i, breakRatio: 1, daysSinceLastSession: 1,
  },
  actualTss: ctl * 7,
});
// Base-rich: ~3 yrs logged, a prior build to CTL 70, now detrained to 17.
const baseRichHistory = [
  ...Array.from({ length: 120 }, (_, i) => wk(20 + (50 * i) / 119, i)), // climb 20→70
  ...Array.from({ length: 40 }, (_, i) => wk(70 - (53 * i) / 39, 120 + i)), // detrain 70→17
];
// De-novo: ~0.6 yr logged, flat and low.
const deNovoHistory = Array.from({ length: 30 }, (_, i) => wk(15 + (i % 3), i));

// ——— H1. empty history ⇒ undefined (default rail stands) ————————————————
{
  check("H1", "no history ⇒ undefined (byte-identical default)", deriveBaseRichness([], 17) === undefined);
}

// ——— H2. base-rich vs de-novo richness & ramp cap ——————————————————————
{
  const rich = deriveBaseRichness(baseRichHistory, 17);
  const novice = deriveBaseRichness(deNovoHistory, 17);
  check("H2a", "base-rich: big reclaimable peak ⇒ high richness", !!rich && rich.richness >= 0.7, `${rich?.richness.toFixed(2)} (peak ${rich?.peakHistoricalCtl})`);
  check("H2b", "de-novo: short flat history ⇒ low richness", !!novice && novice.richness <= 0.2, `${novice?.richness.toFixed(2)}`);
  check("H2c", "base-rich ramp cap > de-novo ramp cap",
    rampCapFromRichness(rich!.richness) > rampCapFromRichness(novice!.richness),
    `${rampCapFromRichness(rich!.richness).toFixed(3)} vs ${rampCapFromRichness(novice!.richness).toFixed(3)}`);
}

// ——— H3. rampCapFromRichness bounds & monotonicity ——————————————————————
{
  // Product decision (matrix M1 catch): the derived cap is FLOORED at the
  // ignorance default — having history must never yield a tighter ramp than
  // having none. Richness only ever pushes upward, toward the 1.3 ceiling.
  check("H3a", "richness 0 ⇒ the ignorance default (1.2); richness 1 ⇒ +30%",
    rampCapFromRichness(0) === 1.2 && rampCapFromRichness(1) === 1.3);
  check("H3b", "monotone non-decreasing", rampCapFromRichness(0.3) <= rampCapFromRichness(0.6)
    && rampCapFromRichness(0.6) < rampCapFromRichness(0.9));
  check("H3c", "clamped to [1.20, 1.30]", rampCapFromRichness(-1) === 1.2 && rampCapFromRichness(2) === 1.3);
  // Neutrality for the already-rich: richness ≥ 0.5 sat above the floor
  // before this change and is byte-identical after it.
  // Byte-identical to the OLD linear map above 0.5 — including its float
  // representation (1.1 + 0.2·0.5 is 1.2000…02, not 1.2; the floor must not
  // "clean" it, or already-rich athletes' plans would shift).
  check("H3d", "richness ≥ 0.5 byte-identical to the pre-floor map",
    rampCapFromRichness(0.5) === 1.1 + 0.2 * 0.5 &&
    rampCapFromRichness(0.75) === 1.1 + 0.2 * 0.75 &&
    rampCapFromRichness(1) === 1.1 + 0.2 * 1);
}

// ——— H4. peakHint folds in a demonstrated pre-window CTL ————————————————
{
  const noHint = deriveBaseRichness(deNovoHistory, 17);
  const withHint = deriveBaseRichness(deNovoHistory, 17, 67); // a prior race at CTL 67
  check("H4", "a demonstrated historical peak raises reclaimable ⇒ richer",
    !!withHint && !!noHint && withHint.richness > noHint.richness, `${noHint?.richness.toFixed(2)} → ${withHint?.richness.toFixed(2)}`);
}

/* ——— Plan-level differential (no corpus) ——— */
const zones = deriveZones({ ftpWatts: 250, lthrBpm: 165, runThresholdSpeedMps: 3.8, swimCssMps: 1.4 });
const seedAt = (ctl: number): AthleteState => ({
  ctl, atl: ctl, tsb: 0, last4WeeksTss: [ctl * 7, ctl * 7, ctl * 7, ctl * 7],
  trailingWeeksTss: Array(8).fill(ctl * 7), last4Shares: { swim: 0, bike: 0, run: 1 },
  daysToNextRace: 98, weeksSinceStart: 4, breakRatio: 1, daysSinceLastSession: 1,
});
const REQ: PlanRequest = {
  raceName: "Diff Half", raceDate: "2026-10-18", raceType: "run-half",
  daysPerWeek: 6, longDay: "sunday", startDate: "2026-07-13", goalTime: "1:24:00",
};

// ——— H5. THE DIFFERENTIAL — base-rich reaches a higher safe peak CTL ————
{
  const CUR = 17; // identical current fitness
  const richPlan = generatePlan(REQ, seedAt(CUR), baseRichHistory, zones);
  const novicePlan = generatePlan(REQ, seedAt(CUR), deNovoHistory, zones);
  const peakCtl = (p: typeof richPlan) => Math.max(...p.weeks.map((w) => w.projected.ctl));
  check("H5a", "base-rich athlete reaches a higher peak CTL than de-novo at the same current CTL",
    peakCtl(richPlan) > peakCtl(novicePlan) + 0.5, `base-rich ${peakCtl(richPlan).toFixed(1)} vs de-novo ${peakCtl(novicePlan).toFixed(1)}`);
  // TSB floor still binds for the base-rich athlete (the faster ramp is not reckless).
  check("H5b", "base-rich plan still respects the −25 TSB floor",
    richPlan.weeks.every((w) => w.projected.tsb >= -25), `min tsb ${Math.min(...richPlan.weeks.map((w) => w.projected.tsb)).toFixed(1)}`);
}

// ——— H5c. an active tissue rampCeiling OVERRIDES base-richness ——————————
{
  const CUR = 17;
  const free = generatePlan(REQ, seedAt(CUR), baseRichHistory, zones);
  const acute = generatePlan(
    { ...REQ, tissueConstraints: [{ site: "achilles", status: "acute", provocation: "impact", caps: { rampCeiling: 1.05, longRunKm: 14 } }] },
    seedAt(CUR), baseRichHistory, zones
  );
  const peakCtl = (p: typeof free) => Math.max(...p.weeks.map((w) => w.projected.ctl));
  check("H5c", "an acute tissue ramp cap holds the base-rich athlete back (tissue wins)",
    peakCtl(acute) < peakCtl(free) - 0.5, `capped ${peakCtl(acute).toFixed(1)} vs free ${peakCtl(free).toFixed(1)}`);
  // The acute rampCeiling (1.05) must actually BIND — not be floored back to 1.10
  // (the bug fixed in the hardening pass). Allow a small rounding band over reps.
  const t = acute.weeks.map((w) => w.targetTss);
  let worst = 0;
  for (let i = 1; i < acute.weeks.length; i++) {
    if (acute.weeks[i].phase === "taper" || acute.weeks[i].phase === "race") continue;
    if (t[i - 1] > 0) worst = Math.max(worst, (t[i] - t[i - 1]) / t[i - 1]);
  }
  check("H5d", "the acute +5% ramp ceiling binds (well under the base-rich +27%)", worst <= 0.09, `worst +${(worst * 100).toFixed(0)}%`);
}

// ——— H6. NEUTRALITY — rampCap undefined vs an explicit 1.2 are identical ——
{
  const eng = new TaperV1({ anchorV2: true });
  const s: AthleteState = { ...seedAt(20), goalPeakCtl: 30, prevPrescribedTss: 150 };
  const a = eng.prescribeWeek({ ...s }).weekTss; // rampCap undefined ⇒ literal +20% rail
  const b = eng.prescribeWeek({ ...s, rampCap: 1.2 }).weekTss; // explicit +20%
  check("H6", "rampCap undefined ≡ explicit 1.2 (the default-rail branch is exact)", a === b, `${a} vs ${b}`);
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.log("  " + f);
console.log(`\nhistory: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
