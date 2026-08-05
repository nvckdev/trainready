import { decodePairCode } from "./pair";

/**
 * Pairing-code decode — the dashboard→phone contract, and the first mobile
 * code ever covered by the gauntlet.
 *
 * This module is the entire seam by which the phone learns who the athlete
 * is: thresholds, fitness seed, the population prior, the pairing anchor and
 * the timezone. Every field it silently drops is a plan the phone builds from
 * something other than the truth — which is exactly the class of failure the
 * mobile-lags-dashboard incidents kept producing.
 *
 * Runs under tsx from the repo root: pair.ts imports only `import type` from
 * ./store, so nothing pulls AsyncStorage or react-native in.
 */

const failures: string[] = [];
const passes: string[] = [];
function check(id: string, desc: string, ok: boolean, detail = "") {
  (ok ? passes : failures).push(`${id} ${ok ? "PASS" : "FAIL"} — ${desc}${detail ? ` (${detail})` : ""}`);
}

const THRESHOLDS = { ftpWatts: 250, lthrBpm: 170, runThresholdSpeedMps: 4.0, swimCssMps: 1.2 };
const SEED = {
  ctl: 45,
  atl: 40,
  tsb: 5,
  last4WeeksTss: [280, 290, 300, 310],
  last4Shares: { swim: 0, bike: 0.1, run: 0.9 },
  daysToNextRace: null,
  weeksSinceStart: 10,
  breakRatio: 1,
  daysSinceLastSession: 1,
};

const encode = (payload: unknown) =>
  "TAPER1." + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

const full = {
  v: 1,
  name: "Test Athlete",
  thresholds: THRESHOLDS,
  seed: SEED,
  anchor: "2026-07-15",
  tz: "America/New_York",
  prior: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

// ——— P1. every field on the wire reaches the stored athlete ————————————————
{
  const r = decodePairCode(encode(full));
  if ("error" in r) {
    check("P1", "a complete code decodes", false, r.error);
  } else {
    check("P1a", "name, thresholds and seed survive",
      r.athlete.name === "Test Athlete" &&
        r.athlete.thresholds.runThresholdSpeedMps === 4.0 &&
        r.athlete.seed.ctl === 45);
    check("P1b", "the population prior rides across (refinement 2 on-device)",
      r.athlete.priorWeights?.length === 11, `${r.athlete.priorWeights?.length}`);
    check("P1c", "the pairing anchor is PERSISTED on the athlete, not just returned",
      r.athlete.anchor === "2026-07-15", r.athlete.anchor ?? "missing");
    check("P1d", "the athlete's timezone is persisted (one definition of today)",
      r.athlete.tz === "America/New_York", r.athlete.tz ?? "missing");
    check("P1e", "a real pairing is never marked demo", r.athlete.demo === false);
  }
}

// ——— P2. absent optional fields stay absent, never invented ————————————————
{
  const bare = { v: 1, name: "Bare", thresholds: THRESHOLDS, seed: SEED };
  const r = decodePairCode(encode(bare));
  if ("error" in r) {
    check("P2", "a minimal code decodes", false, r.error);
  } else {
    check("P2a", "no prior ⇒ the field is absent (engine stays byte-identical)",
      r.athlete.priorWeights === undefined);
    check("P2b", "no anchor ⇒ absent, so the seed is used as-is rather than decayed from a guess",
      r.athlete.anchor === undefined);
    check("P2c", "no tz ⇒ absent, so localToday falls back to the device clock",
      r.athlete.tz === undefined);
  }
}

// ——— P3. malformed input is refused with a reason, never half-applied ———————
{
  const cases: Array<[string, string]> = [
    ["", "empty"],
    ["hello", "no prefix"],
    ["TAPER1.not-base64!!", "undecodable"],
    [encode({ ...full, v: 99 }), "future version"],
    [encode({ v: 1, name: "x", seed: SEED }), "missing thresholds"],
    [encode({ v: 1, name: "x", thresholds: THRESHOLDS }), "missing seed"],
    [encode({ v: 1, name: "x", thresholds: { ...THRESHOLDS, lthrBpm: "high" }, seed: SEED }), "non-numeric threshold"],
  ];
  const leaked = cases.filter(([code]) => !("error" in decodePairCode(code)));
  check("P3a", "every malformed code is refused, none partially applied",
    leaked.length === 0, leaked.map(([, why]) => why).join(", "));
  const messages = cases.every(([code]) => {
    const r = decodePairCode(code);
    return "error" in r && r.error.length > 10;
  });
  check("P3b", "…each with an athlete-readable reason", messages);
}

// ——— P4. a malformed prior is dropped, not passed through ————————————————
{
  for (const [prior, label] of [
    [[1, 2, 3], "wrong length"],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, "x"], "non-numeric member"],
    ["nope", "not an array"],
  ] as Array<[unknown, string]>) {
    const r = decodePairCode(encode({ ...full, prior }));
    const ok = !("error" in r) && r.athlete.priorWeights === undefined;
    check(`P4:${label}`, "a malformed prior is dropped rather than fed to the engine", ok);
  }
}

// ——— P5. whitespace tolerance (codes get pasted out of chat/email) —————————
{
  const spaced = encode(full).replace(/(.{20})/g, "$1 \n");
  const r = decodePairCode(spaced);
  check("P5", "a code pasted with whitespace still decodes", !("error" in r),
    "error" in r ? r.error : "");
}

for (const p of passes) console.log("  " + p);
for (const f of failures) console.error("  " + f);
console.log(`\nmobile pair: ${passes.length} passed, ${failures.length} failed`);
process.exit(failures.length);
