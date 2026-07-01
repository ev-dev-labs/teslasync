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
  npm test -- --run
  TEST_EXIT=$?
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
EXISTING_TARGETS=()
for t in "${TARGETS[@]}"; do [ -f "$t" ] && EXISTING_TARGETS+=("$t"); done
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
