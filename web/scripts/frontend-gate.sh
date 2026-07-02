#!/usr/bin/env bash
#
# frontend-gate.sh — per-unit verification gate for the frontend gold-standard
# rewrite (React 19, Radix/Base UI, Tailwind v4, React Router v7, visx/uPlot,
# MapLibre, Storybook+Chromatic, Playwright E2E — refactor/frontend-gold-standard-rewrite).
#
# Usage:
#   scripts/frontend-gate.sh <target_rel_path> [<target_rel_path> ...]
#       Per-unit mode: target paths are RELATIVE TO web/ (e.g. src/components/ui/Modal.tsx).
#       Type-checks and lints are SCOPED to the target files only — during a large
#       parallel migration many sibling files may not exist yet, so a whole-app
#       tsc/eslint run would fail units for reasons unrelated to THIS unit. The
#       loop driver re-runs pending units until siblings land.
#
#   scripts/frontend-gate.sh --full
#       Phase-boundary mode: runs the FULL existing `npm run lint` (tsc + eslint +
#       all ~28 audits + i18n validation) and `npm test` across the whole app.
#       Invoked once per phase completion, not per-unit, so full-repo drift is
#       still caught even though per-unit checks are scoped.
#
# Prints machine-greppable markers (GATE_TSC_TARGET_ERRORS=, GATE_ESLINT_ERRORS=,
# GATE_FORBIDDEN=, GATE=PASS|FAIL) and exits 0 (pass) / 1 (fail).
set -o pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)" || exit 2  # -> web/

if [ "$1" = "--full" ]; then
  echo "frontend-gate: FULL phase-boundary check (lint + tsc + test)"
  npm run lint
  LINT_EXIT=$?
  npx tsc --noEmit
  TSC_EXIT=$?
  # NODE_OPTIONS workaround: Node >=22 introduced an experimental global
  # `localStorage` that collides with jsdom's own implementation in this
  # test environment, causing ~198 unrelated test files to fail with
  # "Cannot read properties of undefined (reading 'clear')". CI pins Node 20
  # (predates this global) so it never hits this; local sandboxes on newer
  # Node need the flag disabled. Verified pre-existing/unrelated-to-any-diff
  # by the p0-foundation/0001-react-19-upgrade unit (byte-identical failing
  # set before/after that change). Harmless no-op on Node <22.
  #
  # KNOWN_PREEXISTING_FAILURES: these 2 files fail on the untouched baseline
  # commit (a766b358a, before any frontend-gold-standard-rewrite work) for
  # reasons unrelated to this migration (route-count/description-catalog
  # drift against main, not this branch's changes) — verified independently
  # by two separate units (p0-foundation/0001-react-19-upgrade and this
  # gate script's own --full run on 2026-07-02). Listed explicitly (not
  # silently ignored) so a genuinely NEW failure in any OTHER file still
  # fails the gate, and so any change to THIS list is a reviewable diff.
  KNOWN_PREEXISTING_FAILURES="src/__tests__/lazyRoutes.smoke.test.ts src/features/explore/__tests__/featureCatalog.test.ts"
  TEST_TMPDIR="$(mktemp -d -t frontend-test-XXXXXX)"
  TEST_JSON="$TEST_TMPDIR/results.json"
  NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --reporter=json --outputFile="$TEST_JSON" >"$TEST_TMPDIR/stdout.log" 2>&1
  TEST_RAW_EXIT=$?
  NEW_FAILURES=""
  REPORT_OK=0
  if [ -s "$TEST_JSON" ]; then
    REPORT_OK=1
    NEW_FAILURES="$(node -e "
      const r = JSON.parse(require('fs').readFileSync('$TEST_JSON', 'utf8'));
      const known = new Set('$KNOWN_PREEXISTING_FAILURES'.split(' '));
      const failedFiles = (r.testResults || [])
        .filter((t) => t.status === 'failed')
        .map((t) => require('path').relative(process.cwd(), t.name));
      const unexpected = failedFiles.filter((f) => !known.has(f));
      console.log(unexpected.join(' '));
    " 2>/dev/null)"
  else
    echo "WARNING: no JSON test report produced at $TEST_JSON -- cannot verify known-vs-new failures, treating as a hard failure rather than silently passing"
  fi
  tail -40 "$TEST_TMPDIR/stdout.log"
  rm -rf "$TEST_TMPDIR"
  if [ "$REPORT_OK" -eq 0 ] && [ "$TEST_RAW_EXIT" -ne 0 ]; then
    # Report genuinely missing/unparseable AND tests failed: never silently
    # treat this as green (this exact class of silent-pass bug was caught
    # and fixed in this same file on 2026-07-02 — see git blame).
    TEST_EXIT=1
    echo "GATE_FULL_TEST_REPORT_MISSING=true"
  elif [ -n "$NEW_FAILURES" ]; then
    TEST_EXIT=1
    echo "GATE_FULL_TEST_UNEXPECTED_FAILURES=$NEW_FAILURES"
  elif [ "$TEST_RAW_EXIT" -ne 0 ]; then
    # Raw exit was non-zero but every failing file is on the known list —
    # treat as pass for gate purposes (still visible via the raw output above).
    TEST_EXIT=0
    echo "GATE_FULL_TEST_ONLY_KNOWN_PREEXISTING_FAILURES=true"
  else
    TEST_EXIT=0
  fi
  echo "GATE_FULL_LINT_EXIT=$LINT_EXIT"
  echo "GATE_FULL_TSC_EXIT=$TSC_EXIT"
  echo "GATE_FULL_TEST_EXIT=$TEST_EXIT"
  if [ "$LINT_EXIT" -eq 0 ] && [ "$TSC_EXIT" -eq 0 ] && [ "$TEST_EXIT" -eq 0 ]; then
    echo "GATE=PASS"; exit 0
  fi
  echo "GATE=FAIL"; exit 1
fi

TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then echo "frontend-gate: no targets (pass file paths or --full)" >&2; exit 2; fi

# Parallel worktrees are fresh checkouts with no node_modules (gitignored).
# Link the main worktree's install so tsc/eslint can resolve modules.
if [ ! -e node_modules ]; then
  COMMON="$(git rev-parse --git-common-dir 2>/dev/null)"
  if [ -n "$COMMON" ]; then
    MAIN="$(cd "$(dirname "$COMMON")" 2>/dev/null && pwd)"
    if [ -n "$MAIN" ] && [ -d "$MAIN/web/node_modules" ] && [ "$MAIN/web" != "$(pwd)" ]; then
      ln -sfn "$MAIN/web/node_modules" node_modules
      echo "frontend-gate: linked node_modules <- $MAIN/web/node_modules"
    fi
  fi
fi

# --- Target-scoped type check -----------------------------------------------
TSC_OUT="$(mktemp -t frontend-tsc.XXXXXX)"
npx tsc --noEmit > "$TSC_OUT" 2>&1
RAW=$?
TSC_ERR=0
for t in "${TARGETS[@]}"; do
  n=$(grep -F "$t" "$TSC_OUT" | grep -cE ': error TS' || true)
  TSC_ERR=$((TSC_ERR + n))
done
echo "GATE_TSC_TARGET_ERRORS=$TSC_ERR (raw_tsc_exit=$RAW)"
if [ "$TSC_ERR" -gt 0 ]; then
  echo "--- type errors in target files ---"
  for t in "${TARGETS[@]}"; do grep -F "$t" "$TSC_OUT" | grep -E ': error TS' || true; done
fi
rm -f "$TSC_OUT"

# --- Target-scoped eslint ----------------------------------------------------
# eslint.config.js only registers `files` blocks for .ts/.tsx (see its own
# header comment: "We apply the linter to every .ts / .tsx file in the
# project"). Non-source targets (package.json, *.yml, *.md, ...) don't match
# any block, so ESLint's flat config treats them as uncovered and emits a
# "File ignored because of a matching ignore pattern" warning when passed
# explicitly on the CLI — a false positive unrelated to code quality that
# would fail every unit whose target list includes a non-JS/TS file (e.g.
# dependency-bump units that only touch package.json). Filter to extensions
# ESLint is actually configured to lint before invoking it.
EXISTING_TARGETS=()
for t in "${TARGETS[@]}"; do
  [ -f "$t" ] || continue
  case "$t" in
    *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs) EXISTING_TARGETS+=("$t") ;;
  esac
done
ESLINT_ERR=0
if [ ${#EXISTING_TARGETS[@]} -gt 0 ]; then
  npx eslint "${EXISTING_TARGETS[@]}" --max-warnings 0 > /tmp/frontend-eslint.out 2>&1
  ESLINT_ERR=$?
  [ "$ESLINT_ERR" -ne 0 ] && cat /tmp/frontend-eslint.out
fi
echo "GATE_ESLINT_ERRORS=$ESLINT_ERR"

# --- Forbidden / regression-risk pattern scan on target files only ----------
# Mirrors the repo's ⛔ PROHIBITED PATTERNS list plus this migration's own
# "don't revert to the old stack" rules.
PH=0
PAT='TODO|FIXME|Coming soon|coming soon|Placeholder|placeholder|Not implemented|not implemented|No data available|: any[^A-Za-z]|dangerouslySetInnerHTML'
REVERT_PAT="from 'recharts'|from \"recharts\"|from 'react-leaflet'|from \"react-leaflet\"|from 'leaflet'|from \"leaflet\"|from 'react-router-dom'|from \"react-router-dom\""
for t in "${TARGETS[@]}"; do
  [ -f "$t" ] || continue
  # Shared-library internals (components/charts, components/maps, the Radix
  # primitive wrappers themselves) are allowed to import the underlying libs —
  # only flag REVERT_PAT outside those internal implementation directories.
  case "$t" in
    src/components/charts/*|src/components/maps/*) skip_revert=1 ;;
    *) skip_revert=0 ;;
  esac
  m=$(grep -nE "$PAT" "$t" | grep -vE '//\s*ok-any' | wc -l | tr -d ' ')
  if [ "$m" -gt 0 ]; then
    echo "--- forbidden placeholder/stub patterns in $t ---"
    grep -nE "$PAT" "$t" | grep -vE '//\s*ok-any' || true
  fi
  PH=$((PH + m))
  if [ "$skip_revert" -eq 0 ]; then
    rm=$(grep -nE "$REVERT_PAT" "$t" | wc -l | tr -d ' ')
    if [ "$rm" -gt 0 ]; then
      echo "--- reverted-to-old-stack imports in $t ---"
      grep -nE "$REVERT_PAT" "$t" || true
    fi
    PH=$((PH + rm))
  fi
done
echo "GATE_FORBIDDEN=$PH"

if [ "$TSC_ERR" -eq 0 ] && [ "$ESLINT_ERR" -eq 0 ] && [ "$PH" -eq 0 ]; then
  echo "GATE=PASS"
  exit 0
fi
echo "GATE=FAIL"
exit 1
