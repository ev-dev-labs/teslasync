#!/usr/bin/env bash
#
# frontend-loop.sh — autonomous driver for the TeslaSync frontend gold-standard
# rewrite (branch refactor/frontend-gold-standard-rewrite).
#
# Runs the programs IN DEPENDENCY ORDER, re-invoking the parallel runner for
# each program until that program has zero pending prompts (or stalls), then
# advances. Designed to be launched detached (nohup) and left running.
#
#   p0-foundation → p1-tooling → p2-radix-primitives → p3-charts-shared →
#   p4-charts-pages → p5-maps-shared → p6-maps-pages → p7-storybook-stories →
#   p8-e2e-pages
#
# (foundation/tooling must be stable before anything else touches those APIs;
#  charts/maps shared components must land before their consuming pages are
#  verified; Storybook stories + E2E tests are written against the FINAL
#  component set last, to avoid rework churn.)
#
# Usage: JOBS=6 ./frontend-loop.sh
#        JOBS=8 MAX_STALLS=3 ./frontend-loop.sh
#
# Env:
#   JOBS         concurrent prompts per wave (default 4 — this repo's audits/
#                tsc are heavier per-invocation than the RN conversion's, so a
#                more conservative default avoids overloading the machine)
#   MAX_STALLS   advance past a program after this many no-progress waves (default 3)
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PROMPTS="$REPO_ROOT/.github/prompts/frontend-gold-standard"
RUNNER="$PROMPTS/run-prompts.sh"
DONE="$PROMPTS/logs/done.txt"
STATUS="$PROMPTS/logs/frontend-loop-status.txt"
LOOP_LOG="$PROMPTS/logs/frontend-loop-$(date '+%Y-%m-%d_%H-%M-%S').log"
GATE_FULL_LOG="$PROMPTS/logs/frontend-loop-full-gate.log"

JOBS="${JOBS:-4}"
MAX_STALLS="${MAX_STALLS:-3}"
PROGRAMS=(p0-foundation p1-tooling p2-radix-primitives p3-charts-shared p4-charts-pages p5-maps-shared p6-maps-pages p7-storybook-stories p8-e2e-pages)

mkdir -p "$PROMPTS/logs"
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOOP_LOG"; }

pending_for() {
  local prog="$1"
  local total done_n
  total=$(find "$PROMPTS/$prog" -name '*.prompt.md' 2>/dev/null | wc -l | tr -d ' ')
  done_n=$(grep -c "^$prog/" "$DONE" 2>/dev/null); done_n=${done_n:-0}
  echo $(( total - done_n ))
}

write_status() {
  {
    echo "FRONTEND_LOOP_STATUS @ $(date '+%Y-%m-%d %H:%M:%S')"
    echo "jobs=$JOBS  current_program=${1:-?}"
    local grand_total=0 grand_done=0
    for p in "${PROGRAMS[@]}"; do
      local t d
      t=$(find "$PROMPTS/$p" -name '*.prompt.md' 2>/dev/null | wc -l | tr -d ' ')
      d=$(grep -c "^$p/" "$DONE" 2>/dev/null); d=${d:-0}
      grand_total=$(( grand_total + t )); grand_done=$(( grand_done + d ))
      printf "  %-24s %4d / %4d done\n" "$p" "$d" "$t"
    done
    echo "  TOTAL                    ${grand_done} / ${grand_total} done"
  } > "$STATUS"
}

total_pending() {
  local s=0 p
  for p in "${PROGRAMS[@]}"; do s=$(( s + $(pending_for "$p") )); done
  echo "$s"
}

# Phase-boundary full-repo gate: after each program fully completes, run the
# FULL lint+tsc+test suite once (not per-unit) so whole-repo drift can never
# silently accumulate across a 500+-prompt run. Logged but non-fatal — a
# failure here is investigated by the human operator, not auto-retried
# (per-unit gates already caught unit-local regressions).
run_full_gate() {
  local prog="$1"
  log "phase-boundary full gate after $prog ..."
  ( cd "$REPO_ROOT/web" && bash scripts/frontend-gate.sh --full ) >> "$GATE_FULL_LOG" 2>&1
  local rc=$?
  log "phase-boundary full gate after $prog: exit=$rc (see $GATE_FULL_LOG)"
}

log "frontend-loop START jobs=$JOBS programs=${PROGRAMS[*]}"

gpass=0
global_stall=0
while true; do
  gpass=$(( gpass + 1 ))
  before_total=$(total_pending)
  log "=== GLOBAL PASS $gpass START total_pending=$before_total ==="
  [ "$before_total" -le 0 ] && break

  for prog in "${PROGRAMS[@]}"; do
    if [ ! -d "$PROMPTS/$prog" ]; then log "skip $prog (no dir)"; continue; fi
    stalls=0
    while true; do
      write_status "$prog"
      pend_before=$(pending_for "$prog")
      log "pass=$gpass program=$prog pending=$pend_before stalls=$stalls"
      if [ "$pend_before" -le 0 ]; then log "program=$prog COMPLETE"; break; fi

      log "launch wave: $RUNNER --program $prog --jobs $JOBS"
      bash "$RUNNER" --program "$prog" --jobs "$JOBS" >> "$LOOP_LOG" 2>&1

      pend_after=$(pending_for "$prog")
      log "program=$prog pending_after=$pend_after"
      if [ "$pend_after" -le 0 ]; then
        log "program=$prog COMPLETE"
        run_full_gate "$prog"
        break
      fi
      if [ "$pend_after" -ge "$pend_before" ]; then
        stalls=$(( stalls + 1 ))
        log "program=$prog NO PROGRESS (stall $stalls/$MAX_STALLS)"
        if [ "$stalls" -ge "$MAX_STALLS" ]; then
          log "program=$prog STALLED — advancing with $pend_after still pending (will retry next global pass)"
          break
        fi
      else
        stalls=0
      fi
    done
  done

  after_total=$(total_pending)
  log "=== GLOBAL PASS $gpass END total_pending=$after_total (was $before_total) ==="
  [ "$after_total" -le 0 ] && break
  if [ "$after_total" -ge "$before_total" ]; then
    global_stall=$(( global_stall + 1 ))
    log "GLOBAL NO PROGRESS (stall $global_stall/2) — $after_total still pending"
    if [ "$global_stall" -ge 2 ]; then
      log "GLOBAL CONVERGED — $after_total prompts unresolvable after repeated passes; stopping for human review"
      break
    fi
  else
    global_stall=0
  fi
done

write_status "DONE"
log "frontend-loop FINISHED"
