/**
 * Tissue-constraint inference tests (feature 4, app layer). Pure over typed
 * inputs — the file-reading loadTissueConstraints is a thin wrapper over
 * declaredConstraint, tested here deterministically. tsx harness; exit = fails.
 */
import { declaredConstraint } from "./tissue-constraints";

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

// TC1 — the real calibration athlete's declared injury maps as specified.
{
  const c = declaredConstraint({
    area: "lower calf / distal tendons",
    symptoms: "pain on foot rotation around lower calf tendons; occasional pain during running",
  });
  check("TC1a", "declared calf/rotation injury ⇒ a constraint", c != null);
  check("TC1b", "site calf, status tendinopathy, provocation rotation",
    c?.site === "calf" && c?.status === "tendinopathy" && c?.provocation === "rotation",
    c ? `${c.site}/${c.status}/${c.provocation}` : "null");
  check("TC1c", "it caps the long run (~24 km) and nothing else",
    c?.caps.longRunKm === 24 && c?.caps.weeklyKm === undefined && c?.caps.maxSessionIntensity === undefined,
    JSON.stringify(c?.caps));
  check("TC1d", "why carries the athlete's own symptom text", /rotation/i.test(c?.why ?? ""));
}

// TC2 — non-running tissue / empty text ⇒ no constraint (no prophylaxis).
{
  check("TC2a", "a shoulder issue is not a running-load constraint", declaredConstraint({ area: "shoulder", symptoms: "rotator cuff ache" }) === null);
  check("TC2b", "empty entry ⇒ null", declaredConstraint({}) === null);
}

// TC3 — provocation & status inference from symptom wording.
{
  const speed = declaredConstraint({ area: "achilles", symptoms: "tight during fast track intervals" });
  check("TC3a", "speed wording ⇒ intensity cap", speed?.provocation === "speed" && speed?.caps.maxSessionIntensity != null, JSON.stringify(speed?.caps));
  const acute = declaredConstraint({ area: "knee", symptoms: "acute sharp pain, can't run", status: "acute" });
  check("TC3b", "acute wording ⇒ status acute (+ ramp hold)", acute?.status === "acute" && acute?.caps.rampCeiling === 1.05, JSON.stringify(acute?.caps));
  const vol = declaredConstraint({ area: "shin", symptoms: "aches after high mileage weeks" });
  check("TC3c", "volume wording on shin ⇒ weekly-km cap", vol?.provocation === "volume" && vol?.caps.weeklyKm != null, JSON.stringify(vol?.caps));
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.log("  " + f);
console.log(`\ntissue-constraints: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
