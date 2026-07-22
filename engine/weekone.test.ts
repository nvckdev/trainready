import { TaperV1 } from "./learned.ts";
import type { AthleteState } from "./types.ts";

/**
 * Week-1 base floor anchored to demonstrated capacity (refinement 6). tsx
 * script; exit code = failures.
 *
 * Clamp №5's floor was 1.15 × CTL×7 — maintenance from a DECAYED CTL, which
 * understates a returning athlete whose recent weeks prove more. The floor
 * now anchors to max(CTL×7, recent peak week × 0.95^weeksSince) — the same
 * demonstrated-capacity term anchor-v2's ceiling already uses — and stays
 * min-capped by the per-athlete ramp rails, so it can never exceed the
 * ceiling. Still triggered ONLY by the explicit isFirstPlanWeek signal
 * (never on the backtest path — the prevPrescribedTss leak lesson).
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

/** Train an engine past MIN_TRAIN so the learned path (and its floors) are live. */
function trained(): TaperV1 {
  const eng = new TaperV1({});
  let ctl = 15;
  let atl = 15;
  const last8: number[] = [];
  for (let i = 0; i < 30; i++) {
    eng.observe(
      {
        ctl, atl, tsb: ctl - atl,
        last4WeeksTss: last8.slice(-4).length ? last8.slice(-4) : [0],
        last4Shares: { swim: 0, bike: 0, run: 1 },
        daysToNextRace: null, weeksSinceStart: i, breakRatio: 1, daysSinceLastSession: 1,
      },
      100
    );
    for (let d = 0; d < 7; d++) {
      const t = d < 6 ? 100 / 6 : 0;
      ctl = ctl + (t - ctl) / 42;
      atl = atl + (t - atl) / 7;
    }
    last8.push(100);
    if (last8.length > 8) last8.shift();
  }
  return eng;
}

// The calibration shape: decayed CTL ~17 (maintenance 119 TSS) but recent
// weeks demonstrating far more — the returning athlete the old floor sold short.
const returning: AthleteState = {
  ctl: 17, atl: 5, tsb: 12,
  last4WeeksTss: [45, 45, 75, 334],
  trailingWeeksTss: [40, 42, 45, 45, 45, 45, 75, 334],
  last4Shares: { swim: 0, bike: 0, run: 1 },
  daysToNextRace: 90, weeksSinceStart: 30, breakRatio: 1.2, daysSinceLastSession: 1,
};
const tmean = returning.last4WeeksTss.reduce((s, v) => s + v, 0) / 4; // 124.75
const rampRef = Math.max(334, 0.7 * 334); // prev non-zero=334, best-of-6·0.7
const railCeil = Math.min(tmean * 1.2, rampRef * 1.2); // 149.7 — the binding rail

// ——— W1. the floor reflects demonstrated capacity, rails still win ————————
{
  const eng = trained();
  const flagged = eng.prescribeWeek({ ...returning, isFirstPlanWeek: true });
  const oldFloor = Math.min(1.15 * returning.ctl * 7, railCeil); // 137.2 — the maintenance-anchored floor
  check("W1a", "week-1 floor rises above the old maintenance anchor (capacity seen)",
    flagged.weekTss > oldFloor + 3, `${flagged.weekTss} vs old ${oldFloor.toFixed(0)}`);
  check("W1b", "…but NEVER exceeds the ramp rails (the ceiling wins)",
    flagged.weekTss <= Math.round(railCeil) + 1, `${flagged.weekTss} ≤ ${railCeil.toFixed(0)}`);
}

// ——— W2. the explicit signal is still the sole trigger ————————————————————
{
  const eng = trained();
  const unflagged = eng.prescribeWeek({ ...returning });
  const flagged = eng.prescribeWeek({ ...returning, isFirstPlanWeek: true });
  check("W2a", "backtest-shape state (no flag) is NOT floored",
    unflagged.weekTss < flagged.weekTss, `${unflagged.weekTss} vs ${flagged.weekTss}`);
}

// ——— W3. continuity: no recent peak ⇒ the old maintenance floor stands ————
{
  const eng = trained();
  const steady: AthleteState = {
    ...returning,
    ctl: 17, last4WeeksTss: [110, 112, 115, 118],
    trailingWeeksTss: [100, 105, 108, 110, 110, 112, 115, 118],
  };
  const flagged = eng.prescribeWeek({ ...steady, isFirstPlanWeek: true });
  // capacity = max(119, decayed peak ≈118) ≈ maintenance ⇒ floor ≈ 1.15×119=137,
  // rails ≈ min(113.75·1.2, 118·1.2)=136.5 ⇒ rails shave it to ~137±2.
  check("W3a", "steady athlete's week-1 floor stays ≈ the maintenance anchor (±4)",
    Math.abs(flagged.weekTss - Math.min(1.15 * 119, 136.5)) <= 4, `${flagged.weekTss}`);
}

for (const p of passes) console.log(p);
for (const f of failures) console.error(f);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
