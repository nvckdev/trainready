import { renderBlocks, retitle, scaleSessionStructure } from "./session-scale.ts";
import type { PlannedSessionOut } from "./plan.ts";

/**
 * A damped session must describe itself honestly.
 *
 * engine/replan.ts scaleWeek rescaled tss and durationHr and left title,
 * structure and workout.blocks describing the PRE-damp session. On the stored
 * plan of 2026-08-05 that put "Long run 115" on a 22-minute session and
 * "Easy 60" on a 12-minute one — a ~5x contradiction, live on the Today
 * screen and enough to block 36 of 65 sessions from watch export.
 *
 * The fix is the long-run-fraction lesson again: one quantity, one ruler.
 * Blocks scale with the session, and the text and title are DERIVED from the
 * scaled blocks rather than left behind. Note that rebuilding through the
 * templates cannot work here — run-tempo floors its work segment at 15 min
 * and mins() rounds to the nearest 5, so no template can express an 11-minute
 * session.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const blockSec = (b: { reps?: number; durationSec?: number; recoverySec?: number }) => {
  const reps = b.reps ?? 1;
  return (b.durationSec ?? 0) * reps + (b.recoverySec ?? 0) * Math.max(0, reps - 1);
};
const total = (s: PlannedSessionOut) => (s.workout?.blocks ?? []).reduce((a, b) => a + blockSec(b), 0);

function vo2(): PlannedSessionOut {
  return {
    date: "2026-08-11",
    weekday: "Tue",
    discipline: "run",
    title: "VO2 set",
    durationHr: 0.53,
    tss: 37,
    structure: "WARMUP 10 min easy @ 4:51–5:22/km + 2 strides\nMAIN 4 × 3 min @ 3:43–3:53/km on 90s easy\nCOOLDOWN 8 min easy",
    why: "",
    workout: {
      blocks: [
        { kind: "warmup", zone: "easy", durationSec: 600, paceMinSecPerKm: 291, paceMaxSecPerKm: 322, effortNote: "+ 2 strides" },
        { kind: "main", zone: "vo2", reps: 4, durationSec: 180, recoverySec: 90, recoveryNote: "easy", paceMinSecPerKm: 223, paceMaxSecPerKm: 233 },
        { kind: "cooldown", zone: "easy", durationSec: 480, paceMinSecPerKm: 291, paceMaxSecPerKm: 322 },
      ],
    },
  } as PlannedSessionOut;
}

function easy(mins = 60): PlannedSessionOut {
  return {
    date: "2026-08-05",
    weekday: "Wed",
    discipline: "run",
    title: `Easy ${mins}`,
    durationHr: mins / 60,
    tss: 45,
    structure: `${mins} min easy @ 4:51–5:22/km. HR is the governor; slow down before you speed up.`,
    why: "",
    workout: { blocks: [{ kind: "segment", zone: "easy", durationSec: mins * 60, paceMinSecPerKm: 291, paceMaxSecPerKm: 322 }] },
  } as PlannedSessionOut;
}

// ——— S1. NEUTRALITY: factor 1 changes nothing ————————————————————————————
{
  const s = vo2();
  const before = JSON.stringify(s);
  scaleSessionStructure(s, 1);
  check("S1", "factor 1 is byte-identical (the §12 neutrality gate)", JSON.stringify(s) === before);
}

// ——— S2. blocks scale WITH the session ————————————————————————————————————
{
  const s = vo2();
  const ratioBefore = total(s) / (s.durationHr * 3600);
  s.durationHr = Math.round(s.durationHr * 0.2 * 100) / 100;
  s.tss = Math.round(s.tss * 0.2);
  scaleSessionStructure(s, 0.2);
  const driftBefore = Math.abs(2070 - 0.53 * 3600);
  const driftAfter = Math.abs(total(s) - s.durationHr * 3600);
  check("S2a", "every block shrinks by the damp factor", total(s) === Math.round(2070 * 0.2), `${total(s)}s`);
  // durationHr is stored to 2dp — 36-second granularity — so exact equality is
  // unavailable at any duration. What the fix guarantees is that the gap
  // shrinks with the session instead of staying frozen at the pre-damp size.
  check("S2b", "structure and duration agree to within one rounding step, far closer than before",
    driftAfter <= 40 && driftAfter < driftBefore,
    `${driftBefore.toFixed(0)}s → ${driftAfter.toFixed(0)}s (ratio ${ratioBefore.toFixed(2)} → ${(total(s) / (s.durationHr * 3600)).toFixed(2)})`);
  check("S2c", "the rep count survives (shape preserved, only duration scales)",
    s.workout!.blocks[1].reps === 4);
}

// ——— S3. the title stops lying ————————————————————————————————————————————
{
  const s = easy(60);
  s.durationHr = 0.2;
  s.tss = 9;
  scaleSessionStructure(s, 0.2);
  check("S3a", "a minute-bearing title is regenerated from the scaled duration",
    s.title === "Easy 12", s.title);
  const long = easy(60);
  long.title = "Long run 115";
  long.workout!.blocks[0].durationSec = 115 * 60;
  long.durationHr = 115 / 60;
  const f = 22 / 115;
  long.durationHr = Math.round((115 * f) / 60 * 100) / 100;
  scaleSessionStructure(long, f);
  check("S3b", "…including the case that started this: Long run 115 on a 22-minute session",
    long.title === "Long run 22", long.title);
  const noNumber = vo2();
  scaleSessionStructure(noNumber, 0.5);
  check("S3c", "a title with no minute count is left alone", noNumber.title === "VO2 set", noNumber.title);
}

// ——— S4. the text is DERIVED from the blocks, never stale ————————————————
{
  const s = easy(60);
  s.durationHr = 0.2;
  scaleSessionStructure(s, 0.2);
  check("S4a", "the structure text states the scaled minutes, not the original",
    s.structure.startsWith("12 min") && !s.structure.includes("60 min"), s.structure.slice(0, 40));

  const v = vo2();
  scaleSessionStructure(v, 0.5);
  check("S4b", "an interval session keeps its WARMUP/MAIN/COOLDOWN shape",
    /WARMUP/.test(v.structure) && /MAIN/.test(v.structure) && /COOLDOWN/.test(v.structure), v.structure.replace(/\n/g, " | "));
  check("S4c", "…with the scaled rep duration in the text",
    /4 × 90s/.test(v.structure) || /4 × 1\.5 min/.test(v.structure), v.structure.replace(/\n/g, " | "));
  check("S4d", "pace targets survive scaling (intensity is not a duration)",
    /3:43–3:53\/km/.test(v.structure), v.structure.replace(/\n/g, " | "));
}

// ——— S5. degenerate and missing input ————————————————————————————————————
{
  const bare = { ...easy(30), workout: undefined } as PlannedSessionOut;
  const before = bare.structure;
  bare.durationHr = 0.25; // the caller scales duration first, then the structure
  scaleSessionStructure(bare, 0.5);
  check("S5a", "a session with no blocks still retitles and does not crash",
    bare.title === "Easy 15" && bare.structure === before, `${bare.title}`);
  const zero = easy(30);
  scaleSessionStructure(zero, 0);
  check("S5b", "factor 0 is refused rather than producing a 0-second session",
    total(zero) === 30 * 60, `${total(zero)}s`);
  const neg = easy(30);
  scaleSessionStructure(neg, -1);
  check("S5c", "a negative factor is refused", total(neg) === 30 * 60);
}

// ——— S6. renderBlocks / retitle in isolation ——————————————————————————————
{
  check("S6a", "retitle replaces only the first integer",
    retitle("Easy 45 + strides", 32) === "Easy 32 + strides", retitle("Easy 45 + strides", 32));
  check("S6b", "retitle is identity with no integer", retitle("Tempo intervals", 20) === "Tempo intervals");
  check("S6b2", "the LAST number is the duration — a zone number in the title is not",
    retitle("Zone 2 ride 44", 60) === "Zone 2 ride 60", retitle("Zone 2 ride 44", 60));
  check("S6b3", "an hours-denominated title is rewritten in hours, not minutes",
    retitle("Long ride 1.5h", 90) === "Long ride 1.5h" && retitle("Long ride 1.5h", 60) === "Long ride 1h",
    `${retitle("Long ride 1.5h", 90)} / ${retitle("Long ride 1.5h", 60)}`);
  check("S6b4", "a decimal is never half-rewritten", !/\d\.\d*\d{2,}/.test(retitle("Long ride 2.5h", 45)),
    retitle("Long ride 2.5h", 45));
  const txt = renderBlocks([
    { kind: "warmup", zone: "easy", durationSec: 600, paceMinSecPerKm: 291, paceMaxSecPerKm: 322 },
    { kind: "main", zone: "vo2", reps: 3, durationSec: 120, recoverySec: 60, recoveryNote: "easy", paceMinSecPerKm: 223, paceMaxSecPerKm: 233 },
    { kind: "cooldown", zone: "easy", durationSec: 300 },
  ]);
  check("S6c", "renderBlocks emits the engine's own WARMUP/MAIN/COOLDOWN idiom",
    /^WARMUP 10 min/.test(txt) && /MAIN 3 × 2 min/.test(txt) && /COOLDOWN 5 min/.test(txt), txt.replace(/\n/g, " | "));
  check("S6d", "sub-minute work renders in seconds, not '0 min'",
    /20s/.test(renderBlocks([{ kind: "strides", zone: "vo2", reps: 5, durationSec: 20, recoveryNote: "full recovery" }])),
    renderBlocks([{ kind: "strides", zone: "vo2", reps: 5, durationSec: 20, recoveryNote: "full recovery" }]));
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nsession-scale: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
