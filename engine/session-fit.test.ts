import { fitAround, repsWithin, splitAround } from "./session-fit.ts";

/**
 * A session must be able to express its own declared duration.
 *
 * Measured on 2026-08-05, structure ÷ declared duration across the templates:
 *
 *   run-strides      0.87 at 25 min   (5 min allotted, 100s of strides built)
 *   run-tempo        1.24 at 25 min   (Math.max(15, …) work floor)
 *   run-vo2          1.22 at 25 min   (Math.max(4, …) rep floor)
 *   bike-threshold   1.80 at 25 min → 0.44 at 150 min
 *   bike-vo2         1.88 at 25 min → 0.31 at 150 min  (fixed 47 min, ignores m)
 *   bike-long        2.60 at 25 min   (2 × 20 min tempo added ON TOP of the ride)
 *
 * The floors are real coaching constraints — a tempo without 15 minutes of work
 * is not a tempo, and a VO2 set needs a warmup or it is an injury. They are not
 * licences to overrun the budget. The resolution is that the budget is the
 * hard quantity and the SET yields to it: reps come down before the warmup
 * does, and the warmup/cooldown absorb whatever remains so the total lands
 * exactly on the declared duration.
 *
 * This module is the arithmetic only — no zones, no templates, no plan types —
 * so the rule can be tested without generating a plan.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// ——— F1. fitAround spends the budget EXACTLY ——————————————————————————————
{
  let worst = 0;
  let negative = 0;
  let covered = 0;
  for (let budget = 300; budget <= 20000; budget += 7) {
    for (const set of [0, 340, 990, 1320, 2400]) {
      const { warmSec, coolSec } = fitAround(budget, set, 0.6);
      if (warmSec < 0 || coolSec < 0) negative++;
      // Exactness is claimed only where it is achievable: a set larger than
      // the whole budget cannot be padded to it without negative time. Sizing
      // the set to fit is repsWithin's job (F3), and F2b pins what happens if
      // a caller gets that wrong.
      if (set > budget) continue;
      covered++;
      worst = Math.max(worst, Math.abs(warmSec + set + coolSec - budget));
    }
  }
  check("F1a", `warmup + set + cooldown === budget, exactly, wherever the set fits (${covered} combinations)`,
    worst === 0, `worst residual ${worst}s`);
  check("F1b", "never emits a negative block", negative === 0, `${negative} negative`);
}

// ——— F2. …and splits the remainder the way it was asked to ————————————————
{
  const { warmSec, coolSec } = fitAround(3600, 1200, 0.6);
  check("F2a", "the warmup share is honoured", warmSec === 1440 && coolSec === 960, `${warmSec}/${coolSec}`);
  const tiny = fitAround(1000, 1200, 0.6);
  check("F2b", "a set larger than the budget yields zero warmup/cooldown rather than negative time",
    tiny.warmSec === 0 && tiny.coolSec === 0, `${tiny.warmSec}/${tiny.coolSec}`);
}

// ——— F3. repsWithin never overruns the room it is given ————————————————————
{
  let over = 0;
  let belowMin = 0;
  for (let room = 0; room <= 7200; room += 13) {
    for (const [rep, rec] of [[180, 90], [720, 300], [120, 120]] as const) {
      const n = repsWithin(room, rep, rec, 2, 8);
      const used = n * rep + rec * Math.max(0, n - 1);
      if (n > 2 && used > room) over++;
      if (n < 2) belowMin++;
    }
  }
  check("F3a", "the chosen set fits the room whenever the minimum allows it", over === 0, `${over} overruns`);
  check("F3b", "never returns fewer than the coaching minimum — a 2-rep floor is a floor",
    belowMin === 0, `${belowMin} below`);
}

// ——— F4. the VO2 case that started this ————————————————————————————————————
{
  // A 24-minute VO2 slot (the planner's 0.4 h duration floor). Four 3-minute
  // reps on 90s need 16.5 min, which leaves 7.5 min for warmup AND cooldown
  // before a VO2 effort. The rep count is what yields.
  const room = 24 * 60 - 300 - 180; // budget less a 5 min warmup and 3 min cooldown
  const n = repsWithin(room, 180, 90, 2, 8);
  const set = n * 180 + 90 * (n - 1);
  const { warmSec, coolSec } = fitAround(24 * 60, set, 0.6);
  check("F4a", "a 24-minute VO2 session fits its budget exactly",
    warmSec + set + coolSec === 24 * 60, `${warmSec}+${set}+${coolSec}`);
  check("F4b", "…by dropping a rep rather than skipping the warmup", n === 3 && warmSec >= 300,
    `${n} × 3 min, ${warmSec}s warmup`);
}

// ——— F5. splitAround places a mid-session block inside the session ————————
{
  // bike-long's 2 × 20 min tempo belongs INSIDE the ride, not bolted on after
  // it — the old template added 2400s on top of a duration that already
  // covered the whole ride, which is where the 2.60x came from.
  const parts = splitAround(4 * 3600, 2400);
  check("F5a", "the surrounding easy time plus the insert equals the whole ride",
    parts.leadSec + 2400 + parts.tailSec === 4 * 3600, `${parts.leadSec}+2400+${parts.tailSec}`);
  check("F5b", "the insert sits in the middle, not at one end", parts.leadSec > 0 && parts.tailSec > 0,
    `${parts.leadSec}/${parts.tailSec}`);
  const noRoom = splitAround(1800, 2400);
  check("F5c", "an insert that does not fit is dropped rather than overrunning",
    noRoom.leadSec + noRoom.tailSec === 1800 && noRoom.fits === false, `${noRoom.leadSec}/${noRoom.tailSec}`);
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nsession-fit: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
