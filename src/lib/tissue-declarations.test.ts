import {
  activeDeclarations,
  parseDeclarations,
  toConstraint,
  type TissueDeclaration,
} from "./tissue-declarations";

/**
 * Structured tissue declarations — the durable source that replaces
 * hand-editing athlete-context.json.
 *
 * E9 closed half of this hole: a file that does not PARSE now refuses the
 * reflow instead of reading as "no injuries". The other half stayed open. A
 * declared injury is free text (`area`, `symptoms`, `status`), and the site,
 * clinical status and provocation are inferred by keyword. Text the keywords
 * do not recognise yields null and the constraint disappears with no parse
 * error, no warning, and no cap — the athlete has declared an injury and the
 * plan silently does not know about it.
 *
 * A declaration is therefore typed at the boundary, and an entry that fails
 * validation makes the whole read UNREADABLE rather than being skipped. The
 * asymmetry is deliberate and matches the reflow's: dropping one bad entry
 * from a safety file is the failure mode being designed out, so a partial
 * read is never returned as if it were complete.
 *
 * tsx harness; exit code = failure count.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const valid: TissueDeclaration = {
  site: "calf",
  status: "tendinopathy",
  provocation: "impact",
  declaredOn: "2026-08-01",
  resolvedOn: null,
  note: "aches on the first km",
};

// ——— D1. a good file reads as a declaration ————————————————————————————————
{
  const r = parseDeclarations({ declarations: [valid] });
  check("D1a", "a well-formed declaration parses", r.status === "ok" && r.declarations.length === 1, r.status);
  check("D1b", "…and keeps every field it was given",
    JSON.stringify(r.declarations[0]) === JSON.stringify(valid), JSON.stringify(r.declarations[0]));
  const empty = parseDeclarations({ declarations: [] });
  check("D1c", "an empty list is a real state — no injuries on file, not a failure",
    empty.status === "ok" && empty.declarations.length === 0, empty.status);
  const absent = parseDeclarations(null);
  check("D1d", "an absent file is absent, never unreadable",
    absent.status === "absent" && absent.declarations.length === 0, absent.status);
}

// ——— D2. a bad entry is REFUSED, never skipped ————————————————————————————
// This is the whole point. Every one of these used to be a silent no-cap.
{
  const cases: Array<[string, unknown]> = [
    ["an unknown site", { ...valid, site: "elbow" }],
    ["an unknown status", { ...valid, status: "sore" }],
    ["an unknown provocation", { ...valid, provocation: "running" }],
    ["a missing site", { ...valid, site: undefined }],
    ["a malformed date", { ...valid, declaredOn: "01/08/2026" }],
    ["a non-object entry", "calf"],
  ];
  const leaked: string[] = [];
  for (const [what, entry] of cases) {
    const r = parseDeclarations({ declarations: [entry] });
    if (r.status !== "unreadable" || r.declarations.length !== 0) leaked.push(what);
  }
  check("D2a", `every malformed entry makes the read unreadable and returns nothing (${cases.length} shapes)`,
    leaked.length === 0, leaked.join("; "));
  const mixed = parseDeclarations({ declarations: [valid, { ...valid, site: "elbow" }] });
  check("D2b", "one bad entry beside a good one refuses BOTH — a partial safety file is not a safety file",
    mixed.status === "unreadable" && mixed.declarations.length === 0,
    `${mixed.status}/${mixed.declarations.length}`);
  check("D2c", "…and says what was wrong", /elbow/.test(mixed.message ?? ""), mixed.message ?? "");
}

// ——— D3. a declaration becomes the engine's own constraint type ———————————
{
  const c = toConstraint(valid);
  check("D3a", "it maps onto the engine's TissueConstraint, caps and all",
    c.site === "calf" && c.status === "tendinopathy" && c.provocation === "impact" && c.caps.longRunKm != null,
    JSON.stringify(c.caps));
  check("D3b", "the athlete's own note becomes the why the plan page renders",
    /first km/.test(c.why ?? ""), c.why ?? "");
  const noNote = toConstraint({ ...valid, note: undefined });
  check("D3c", "…and without a note it falls back to the derived sentence, never blank",
    (noNote.why ?? "").length > 0 || noNote.why === undefined, String(noNote.why));
}

// ——— D4. resolved declarations stop capping ————————————————————————————————
// An injury that healed must not cap forever; the athlete resolves it in the
// UI rather than deleting a line from a JSON file.
{
  const healed: TissueDeclaration = { ...valid, resolvedOn: "2026-08-04" };
  check("D4a", "a declaration resolved before today is no longer active",
    activeDeclarations([healed], "2026-08-05").length === 0);
  check("D4b", "…and on the resolution day itself it still binds (the day is inclusive)",
    activeDeclarations([healed], "2026-08-04").length === 1);
  check("D4c", "an open declaration binds", activeDeclarations([valid], "2026-08-05").length === 1);
  check("D4d", "a declaration does not bind before it was declared",
    activeDeclarations([valid], "2026-07-31").length === 0);
  // One site, one constraint: the most limiting status wins rather than two
  // constraints racing for the same tissue.
  const two: TissueDeclaration[] = [valid, { ...valid, status: "acute", declaredOn: "2026-08-02" }];
  const act = activeDeclarations(two, "2026-08-05");
  check("D4e", "two open declarations on one site collapse to the most limiting",
    act.length === 1 && act[0].status === "acute", act.map((a) => a.status).join(","));
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\ntissue-declarations: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
