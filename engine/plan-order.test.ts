import { ENFORCEMENT_PASSES } from "./plan.ts";

/**
 * The pass-ordering invariant, asserted as DATA: no enforcement pass that
 * MEASURES a quantity may be followed by a pass that MOVES that quantity in
 * the direction that violates its bound.
 *
 * This arc hit the same ordering bug three times: the long-run fraction was
 * measured before the intensity shaping moved km underneath it; the tissue
 * weekly-km cap was bound pre-construction and un-bound by the Z1 demotion;
 * the Z1 floor was shaped early and broken by the two rails that ran after
 * it. Each fix moved a pass later or re-measured — and each was found by a
 * sweep, not by design. ENFORCEMENT_PASSES makes the order and the
 * measure/move contracts explicit, per activation class (a capped and an
 * uncapped week run DIFFERENT pass sequences), and this test recomputes the
 * violation table from the data. Inserting or reordering a pass now requires
 * declaring what it measures and moves — and an unsafe declaration fails
 * here before any athlete sees the plan.
 *
 * Honest limit: the table documents the code, it does not introspect it. The
 * end-state sweeps (matrix TC1/z1FloorHolds/DS1/FS1, fraction F1–F6) remain
 * the ground truth that the code matches its declaration; this test makes an
 * ordering mistake impossible to make SILENTLY in either place.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

type Dir = "up" | "down" | "both";
const violates = (bound: "max" | "min", dir: Dir) =>
  dir === "both" || (bound === "max" ? dir === "up" : dir === "down");

// The rule, exactly as the three fixes converged on it: a pass may move a
// quantity someone earlier measured ONLY if the bound is re-measured at or
// after the move — "enforce last", as data. An unexcused violating move is
// this arc's entire ordering bug class.
for (const cls of ["uncapped", "capped"] as const) {
  const seq = ENFORCEMENT_PASSES.filter((p) => p.active === cls || p.active === "always");
  const movesOf = (p: (typeof seq)[number]) => p.moves.filter((m) => !("only" in m) || m.only === cls);
  const found: string[] = [];
  for (let i = 0; i < seq.length; i++) {
    for (const m of seq[i].measures) {
      for (let j = i + 1; j < seq.length; j++) {
        for (const mv of movesOf(seq[j])) {
          if (mv.q !== m.q || !violates(m.bound, mv.dir)) continue;
          // Excused iff the bound is re-enforced at or after the move.
          const reMeasured = seq
            .slice(j)
            .some((later) => later.measures.some((lm) => lm.q === m.q && lm.bound === m.bound));
          if (!reMeasured) {
            found.push(`${cls}: ${seq[i].name} measures ${m.q} (${m.bound}) but ${seq[j].name} later moves it ${mv.dir} with no re-measure`);
          }
        }
      }
    }
  }
  check(`O-${cls}`, `every bound survives to the end: measured, moved only with a re-measure after (${seq.length} passes)`,
    found.length === 0, found.join("; "));
}

// The declaration itself must stay honest: every pass names at least one
// move (a pass that moves nothing is not an enforcement pass), and the two
// classes both end on the Z1 floor re-check — the "enforce last" resolution
// all three fixes converged on.
check("O-shape", "every pass declares its moves", ENFORCEMENT_PASSES.every((p) => p.moves.length > 0));
check("O-last", "both activation classes end on the Z1 floor re-check",
  (["uncapped", "capped"] as const).every((cls) => {
    const seq = ENFORCEMENT_PASSES.filter((p) => p.active === cls || p.active === "always");
    return seq[seq.length - 1].name === "z1-floor-recheck";
  }));

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nplan-order: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
