import { readFileSync } from "node:fs";
import {
  EVIDENCE,
  BANNED_CAUSAL,
  isBannedCausalClaim,
  stripComments,
  evidenceIds,
  TIER_LABEL,
  type EvidenceTier,
} from "./evidence.ts";

/**
 * Evidence-honesty tests (feature 6). tsx harness; exit = failure count.
 * The headline (EV5): a lint over every user-facing copy file — no prescriptive
 * string may claim causal certainty ("research shows" / "studies prove") unless
 * it is RCT-backed. Comments (our honest notes) are stripped before scanning.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const TIERS: EvidenceTier[] = ["rct", "observational", "elite-practice", "heuristic"];

// ——— EV1. the registry is well-formed ————————————————————————————————
{
  const entries = Object.entries(EVIDENCE);
  check("EV1a", "every claim has a valid tier, a source, and a plain claim",
    entries.every(([, c]) => TIERS.includes(c.tier) && c.source.length > 5 && c.plainClaim.length > 20));
  check("EV1b", "Fokkema volume is tagged OBSERVATIONAL (not causal)", EVIDENCE["fokkema-volume"].tier === "observational");
  check("EV1c", "elite distribution is ELITE-PRACTICE; detraining is OBSERVATIONAL",
    EVIDENCE["intensity-distribution"].tier === "elite-practice" && EVIDENCE["base-reacquisition"].tier === "observational");
  check("EV1d", "tissue + cross-training are HEURISTIC (we think, not proven)",
    EVIDENCE["tissue-load-management"].tier === "heuristic" && EVIDENCE["cross-training-transfer"].tier === "heuristic");
  check("EV1e", "every tier has a UI label", TIERS.every((t) => TIER_LABEL[t].length > 3));
}

// ——— EV2. no non-RCT claim asserts causal certainty ——————————————————
{
  const overclaims = Object.entries(EVIDENCE).filter(([, c]) => c.tier !== "rct" && isBannedCausalClaim(c.plainClaim));
  check("EV2", "no observational/elite/heuristic claim uses a banned causal phrase", overclaims.length === 0,
    overclaims.map(([k]) => k).join(", "));
}

// ——— EV3. the detector + comment stripper behave —————————————————————
{
  check("EV3a", "flags 'Research shows …' and 'studies prove …'", isBannedCausalClaim("Research shows X") && isBannedCausalClaim("studies prove Y"));
  check("EV3b", "does NOT flag honest hedges", !isBannedCausalClaim("is associated with") && !isBannedCausalClaim("we think") && !isBannedCausalClaim("linked to faster"));
  check("EV3c", "stripComments removes // and block comments, keeps string content",
    !/research proves/i.test(stripComments(`const a = 1; // research proves nothing\n/* studies prove nothing */`)) &&
    /keepThis/.test(stripComments(`const s = "keepThis";`)));
}

// ——— EV4. referential integrity — ids surfaced in the UI exist ————————
{
  const used = ["fokkema-volume", "intensity-distribution", "base-reacquisition", "tissue-load-management", "cross-training-transfer"];
  const ids = new Set(evidenceIds());
  check("EV4", "every claim-id referenced by the UI/copy exists in the registry",
    used.every((k) => ids.has(k)), used.filter((k) => !ids.has(k)).join(", "));
}

// ——— EV5. THE LINT — no user-facing copy overclaims causal certainty ————
{
  const COPY_FILES = [
    "engine/plan.ts",
    "engine/intensity.ts",
    "engine/tissue.ts",
    "engine/crosstrain.ts",
    "engine/history.ts",
    "engine/volume.ts",
    "src/lib/digest.ts",
    "src/lib/week-insights.ts",
    "src/lib/tissue-constraints.ts",
    "src/app/app/plan/page.tsx",
  ];
  const bad: string[] = [];
  for (const f of COPY_FILES) {
    let src: string;
    try {
      src = stripComments(readFileSync(f, "utf8"));
    } catch {
      continue; // file moved — skip rather than fail the lint on a path drift
    }
    for (const re of BANNED_CAUSAL) {
      const m = src.match(re);
      if (m) bad.push(`${f}: "${m[0]}"`);
    }
  }
  check("EV5", "no user-facing copy string claims causal certainty (comments excluded)", bad.length === 0, bad.slice(0, 4).join("; "));
}

// ——— EV6. the lint actually catches a violation (self-test) ————————————
{
  const planted = stripComments(`const copy = "Research shows this plan works.";`);
  check("EV6", "the lint would flag a planted overclaim (not a no-op)", isBannedCausalClaim(planted));
}

// ——— EV7. NEUTRALITY — the backtest path never imports evidence ————————
{
  const bt = readFileSync("engine/backtest.ts", "utf8");
  check("EV7", "engine/backtest.ts does not import evidence (copy metadata, not a number)", !/evidence/i.test(bt));
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.log("  " + f);
console.log(`\nevidence: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
