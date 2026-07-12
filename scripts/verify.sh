#!/usr/bin/env bash
# Taper pre-commit verification — runs automatically via .githooks/pre-commit.
# Thorough by design (~1 min with build). Escape hatches:
#   TAPER_SKIP_BUILD=1 git commit ...   # skip the production build step
#   git commit --no-verify              # emergencies only
set -u
cd "$(git rev-parse --show-toplevel)"

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'
FAILURES=0
step() { # step <name> <cmd...>
  local name="$1"; shift
  if "$@" >/tmp/taper-verify-step.log 2>&1; then
    echo "  ${GRN}PASS${RST} $name"
  else
    echo "  ${RED}FAIL${RST} $name"
    tail -12 /tmp/taper-verify-step.log | sed 's/^/       /'
    FAILURES=$((FAILURES+1))
  fi
}

echo "Taper verify —"

# ── 1. Privacy tripwire: athlete health data must never be committed ──
if git diff --cached --name-only | grep -q '^data/'; then
  echo "  ${RED}FAIL${RST} privacy: files under data/ are staged:"
  git diff --cached --name-only | grep '^data/' | sed 's/^/       /'
  FAILURES=$((FAILURES+1))
else
  echo "  ${GRN}PASS${RST} privacy (nothing under data/ staged)"
fi

# ── 2. Types (three tsconfigs, all intentional) ──
step "tsc app"      npx tsc --noEmit
step "tsc engine"   npx tsc -p engine --noEmit
step "tsc pipeline" npx tsc -p pipeline --noEmit

# ── 3. Lint ──
step "eslint" npm run -s lint

# ── 4. Plan invariants vs committed baseline ──
# Known failures live in scripts/invariants-baseline.txt (the hardening work
# order). NEW failures block; fixed ones prompt a baseline shrink.
INV_OUT=$(npm run -s engine:invariants 2>&1 || true)
CURRENT_FAILS=$(echo "$INV_OUT" | grep -oE '^\s*I[0-9]+[ab]? FAIL' | awk '{print $1}' | sort -u)
BASELINE=$(sort -u scripts/invariants-baseline.txt 2>/dev/null | grep -v '^#' | grep . || true)
NEW_FAILS=$(comm -23 <(echo "$CURRENT_FAILS") <(echo "$BASELINE"))
FIXED=$(comm -13 <(echo "$CURRENT_FAILS") <(echo "$BASELINE"))
if [ -n "$NEW_FAILS" ]; then
  echo "  ${RED}FAIL${RST} invariants: NEW failures not in baseline: $(echo $NEW_FAILS)"
  echo "$INV_OUT" | grep 'FAIL' | sed 's/^/       /'
  FAILURES=$((FAILURES+1))
else
  echo "  ${GRN}PASS${RST} invariants (failures ⊆ baseline: $(echo $BASELINE | tr '\n' ' '))"
fi
if [ -n "$FIXED" ]; then
  echo "  ${YLW}NOTE${RST} invariants now passing: $(echo $FIXED) — remove them from scripts/invariants-baseline.txt"
fi

# ── 5. Data-dependent gates (only when the local corpus exists) ──
if [ -f data/datasets/weekly-examples.jsonl ]; then
  step "pipeline" npm run -s pipeline
  MAE=$(grep -oE 'CTL MAE \| [0-9.]+' data/reports/phase0.md | grep -oE '[0-9.]+' | head -1)
  if [ -n "$MAE" ] && awk "BEGIN{exit !($MAE <= 2.0)}"; then
    echo "  ${GRN}PASS${RST} phase0 gate (CTL MAE $MAE ≤ 2.0)"
  else
    echo "  ${RED}FAIL${RST} phase0 gate (CTL MAE ${MAE:-unknown} > 2.0)"
    FAILURES=$((FAILURES+1))
  fi

  BT=$(npm run -s engine:backtest 2>/dev/null)
  node -e '
    const t = process.argv[1];
    const j = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    const v = j.taperV1;
    // Pinned baselines (taper-verify skill). Re-pinned 2026-07-12 after
    // protocol-locking the taper: executed-week MAE worsened by design
    // (the engine no longer mimics under-tapering; I5b guards correctness).
    // Changing these requires updating the skill AND a commit-message reason.
    const ok = v.maeConsistent <= 88.2 && v.corr >= 0.80 && v.dir >= 74;
    console.log(JSON.stringify(v));
    process.exit(ok ? 0 : 1);
  ' "$BT" >/tmp/taper-bt.log 2>&1
  if [ $? -eq 0 ]; then
    echo "  ${GRN}PASS${RST} backtest baselines $(cat /tmp/taper-bt.log)"
  else
    echo "  ${RED}FAIL${RST} backtest regressed vs pinned (mae ≤ 88.2, corr ≥ 0.80, dir ≥ 74): $(cat /tmp/taper-bt.log)"
    FAILURES=$((FAILURES+1))
  fi
else
  echo "  ${YLW}SKIP${RST} pipeline/backtest gates (no local corpus in data/)"
fi

# ── 6. Production build ──
if [ "${TAPER_SKIP_BUILD:-0}" = "1" ]; then
  echo "  ${YLW}SKIP${RST} next build (TAPER_SKIP_BUILD=1)"
else
  step "next build" npm run -s build
fi

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "${RED}verify failed: $FAILURES step(s).${RST} Fix, or bypass deliberately with --no-verify."
  exit 1
fi
echo "${GRN}verify passed.${RST}"
