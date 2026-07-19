/**
 * node:fs shim for on-device bundles. The engine's fs reads are OPTIONAL corpus
 * lookups, each guarded by existsSync or try/catch with a safe default
 * (loadRaceAnchors → [], trainingEras → null). existsSync=false routes every
 * caller down its documented "corpus absent" branch; readFileSync throwing is
 * the belt-and-suspenders for any unguarded future call (it would surface in
 * dev immediately instead of silently misreading).
 */
exports.existsSync = () => false;
exports.readFileSync = () => {
  throw new Error("fs is unavailable on device; corpus reads must stay behind existsSync guards");
};
