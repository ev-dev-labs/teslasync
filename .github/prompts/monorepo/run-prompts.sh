#!/usr/bin/env bash
#
# TeslaSync — Master runner for the monorepo native-apps prompt sequence
# (Windows / Android / Apple, plus shared core + foundation + hardening).
#
# macOS / Linux counterpart to run-prompts.ps1 in this same folder. Keep the
# two in sync when either gains new features — the discovery order, done.txt
# tracking, log-gate (Test-LogSaysRed) semantics, and self-test are intended
# to be behaviourally identical.
#
# DESCRIPTION
#   Auto-discovers .prompt.md files under .github/prompts/monorepo/p*-*/
#   (recursive — picks up pages/, dashboard-widgets/, modals-dialogs/,
#   feature-views/, widget-primitives/, shared-meaningful/, misc-surfaces/
#   subdirs inside each platform program) and runs them via
#   `copilot --yolo --autopilot -s` with the prompt body piped on stdin.
#
#   Walks program directories in numeric order:
#     p0-foundation -> p1-shared -> p2-windows -> p3-android -> p4-apple -> p5-hardening
#   Within each program, prompts run in NATURAL NUMERIC order (S0 < S1 < S2 <
#   ... < S10 < S11, never the lexical S0 < S1 < S10 < S2 bug). A single
#   done.txt at monorepo/logs/done.txt tracks completion across all programs
#   so reruns are safe and resumable.
#
#   The top-level 0000-methodology.prompt.md at the monorepo root is the
#   meta-document — it lives outside any p*-* dir and is NOT executed.
#
#   Each prompt is expected to commit its own changes. The runner does not
#   commit on the prompt's behalf.
#
# USAGE
#   ./run-prompts.sh                                 # Run all pending prompts across all programs
#   ./run-prompts.sh --program p2-windows            # Run only one program directory
#   ./run-prompts.sh --start-from 5                  # Resume from global prompt #5
#   ./run-prompts.sh --dry-run                       # Preview without executing
#   ./run-prompts.sh --model claude-sonnet-4.6       # Use a specific model
#   ./run-prompts.sh --single 0001-apps-skeleton.prompt.md
#                                                    # Run one prompt by filename (recursive search)
#   ./run-prompts.sh --reset                         # Wipe done.txt and start fresh
#   ./run-prompts.sh --continue-on-red               # Do not STOP after a red prompt
#   ./run-prompts.sh --jobs 6                         # Run 6 prompts CONCURRENTLY, each in
#                                                    # its own git worktree, consolidating
#                                                    # green results onto parallel/<run-id>
#                                                    # then fast-forwarding the launch branch.
#                                                    # (Default 1 = the sequential path.)
#   ./run-prompts.sh --self-test                     # Run the log-gate self-test and exit
#
# NOTE on prompt delivery:
#   Many monorepo prompts exceed the OS command-line length limit when passed
#   via `-p <text>`. This runner feeds the prompt body to copilot on stdin
#   instead — copilot accepts the prompt from stdin when -p is omitted, runs
#   non-interactively under --yolo --autopilot, and exits when stdin closes.

# Intentionally NOT using `set -e`/`set -u`: the control flow relies on
# non-zero exit codes from grep/kill -0/etc. as ordinary signals.
set -o pipefail 2>/dev/null || true

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"   # monorepo -> prompts -> .github -> repo
PROGRAM=""
SINGLE=""
MODEL=""
DRY_RUN=0
RESET=0
START_FROM=1
DELAY_SECONDS=10
TIMEOUT_MINUTES=600
CONTINUE_ON_RED=0
SELF_TEST=0
JOBS=1
WORKER_IDX=""
FORCE=0
KEEP_WORKTREES=0
COPILOT_BIN="${COPILOT_BIN:-copilot}"

# Absolute path to this script (needed to re-invoke ourselves as a worker).
SELF="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/$(basename "${BASH_SOURCE[0]:-$0}")"

TAB="$(printf '\t')"
# Field separator for sort keys. MUST be a non-IFS-whitespace byte (US, 0x1F)
# so that EMPTY fields (empty letter for p0 pure-numeric names, empty reldir
# for top-level files) are preserved on read instead of collapsing.
SEP="$(printf '\037')"

usage() {
    sed -n '3,57p' "${BASH_SOURCE[0]:-$0}" | sed 's/^# \{0,1\}//'
}

# ---------------------------------------------------------------------------
# Argument parsing (supports both `--opt val` and `--opt=val`)
# ---------------------------------------------------------------------------
_args=()
for _a in "$@"; do
    case "$_a" in
        --*=*) _args+=("${_a%%=*}" "${_a#*=}") ;;
        *)     _args+=("$_a") ;;
    esac
done
if [ ${#_args[@]} -gt 0 ]; then set -- "${_args[@]}"; else set --; fi

while [ $# -gt 0 ]; do
    case "$1" in
        --repo-root)        REPO_ROOT="$2"; shift 2 ;;
        --program)          PROGRAM="$2"; shift 2 ;;
        --single)           SINGLE="$2"; shift 2 ;;
        --model)            MODEL="$2"; shift 2 ;;
        --start-from)       START_FROM="$2"; shift 2 ;;
        --delay-seconds)    DELAY_SECONDS="$2"; shift 2 ;;
        --timeout-minutes)  TIMEOUT_MINUTES="$2"; shift 2 ;;
        --dry-run)          DRY_RUN=1; shift ;;
        --reset)            RESET=1; shift ;;
        --continue-on-red)  CONTINUE_ON_RED=1; shift ;;
        --jobs|--parallel)  JOBS="$2"; shift 2 ;;
        --worker)           WORKER_IDX="$2"; shift 2 ;;
        --copilot-bin)      COPILOT_BIN="$2"; shift 2 ;;
        --force)            FORCE=1; shift ;;
        --keep-worktrees)   KEEP_WORKTREES=1; shift ;;
        --self-test)        SELF_TEST=1; shift ;;
        -h|--help)          usage; exit 0 ;;
        *) echo "ERROR: Unknown option: $1" >&2; echo "Run with --help for usage." >&2; exit 1 ;;
    esac
done

PROMPTS_ROOT="$REPO_ROOT/.github/prompts/monorepo"
LOG_DIR="$PROMPTS_ROOT/logs"
DONE_FILE="$LOG_DIR/done.txt"
RUN_LOG="$LOG_DIR/run-$(date '+%Y-%m-%d_%H-%M-%S').log"

# ---------------------------------------------------------------------------
# Colors (suppressed when not a TTY or when NO_COLOR is set)
# ---------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_RESET=$'\033[0m'; C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'
    C_RED=$'\033[31m';  C_YELLOW=$'\033[33m'; C_GRAY=$'\033[90m'
    C_MAGENTA=$'\033[35m'; C_DKYEL=$'\033[33m'
else
    C_RESET=; C_CYAN=; C_GREEN=; C_RED=; C_YELLOW=; C_GRAY=; C_MAGENTA=; C_DKYEL=
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log() {
    local ts entry
    ts="$(date '+%Y-%m-%d %H:%M:%S')"
    entry="[$ts] $*"
    printf '%s\n' "$entry"
    printf '%s\n' "$entry" >> "$RUN_LOG"
}

repeat() { # $1=char $2=count
    local c="$1" n="$2" out=""
    while [ "$n" -gt 0 ]; do out="$out$c"; n=$((n - 1)); done
    printf '%s' "$out"
}

is_done()   { grep -Fxq "$1" "$DONE_FILE" 2>/dev/null; }
mark_done() { printf '%s\n' "$1" >> "$DONE_FILE"; }

# Recursively terminate a process tree by PID (children first), name-agnostic.
kill_tree() { # $1=pid $2=signal(TERM|KILL)
    local p="$1" sig="$2" c
    for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c" "$sig"; done
    kill "-$sig" "$p" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Get-PromptSortKey — natural numeric sort key for a prompt filename.
#
# Emits one tab-separated record:  Letter \t Phase \t Dir \t Seq \t Name \t FullPath
# matching the PowerShell key tuple sorted (Letter, Phase, Dir, Seq, Name).
#
#   1. <Letter><Phase>-<Seq>-slug  (S0-0001, W7-0001, A12-0001) -> (Letter, Phase, Seq)
#   2. <Digit>-slug                (0001-, 0099-)               -> ('', 0, Seq)  -> sorts first
#   3. <Letter>-<Seq>-slug         (W-0001-AlertFeed)           -> (Letter, 999, Seq)
#   4. anything else               (pages/admin/APIKeysPage)    -> ('zzz-unprefixed', 9999, 0)
# ---------------------------------------------------------------------------
compute_sort_key() { # $1=file fullpath  $2=program root
    local file="$1" proot="$2" base name dir reldir letter phase seq
    base="${file##*/}"
    name="${base%.prompt.md}"
    dir="${file%/*}"
    reldir="${dir#"$proot"}"
    reldir="${reldir#/}"

    if [[ "$name" =~ ^([A-Za-z]+)([0-9]+)-([0-9]+) ]]; then
        letter="${BASH_REMATCH[1]}"; phase="${BASH_REMATCH[2]}"; seq="${BASH_REMATCH[3]}"
    elif [[ "$name" =~ ^([0-9]+)- ]]; then
        letter=""; phase=0; seq="${BASH_REMATCH[1]}"
    elif [[ "$name" =~ ^([A-Za-z]+)-([0-9]+) ]]; then
        letter="${BASH_REMATCH[1]}"; phase=999; seq="${BASH_REMATCH[2]}"
    else
        letter="zzz-unprefixed"; phase=9999; seq=0
    fi
    # Strip leading zeros for numeric sort safety (keep at least one digit).
    seq="$((10#$seq))"
    printf '%s\037%s\037%s\037%s\037%s\037%s\n' "$letter" "$phase" "$reldir" "$seq" "$name" "$file"
}

# ---------------------------------------------------------------------------
# Get-PromptArtifactLogPath — parse the prompt body's `| Log | `path` |` row.
# ---------------------------------------------------------------------------
get_artifact_log_path() { # $1=prompt file -> echoes resolved path or ""
    local cell path leaf
    cell="$(grep -oE '\|[[:space:]]*(Output[[:space:]]+log|Log)[[:space:]]*\|[[:space:]]*`[^`]+`[[:space:]]*\|' "$1" 2>/dev/null | head -n1)"
    [ -z "$cell" ] && { echo ""; return; }
    path="$(printf '%s' "$cell" | sed -E 's/.*`([^`]+)`.*/\1/')"
    case "$path" in
        ../logs/*|../../logs/*) leaf="$(basename "$path")"; echo "$LOG_DIR/$leaf" ;;
        /*)                     echo "$path" ;;
        *)                      echo "$REPO_ROOT/$path" ;;
    esac
}

# ---------------------------------------------------------------------------
# Test-LogSaysRed — detect red markers in a child log even when CLI exits 0.
#
# "Final marker wins": EXIT=/STATUS=/COMMIT_EXIT= are judged by their LAST
# occurrence (gates may legitimately retry). Absence of markers is NOT a
# failure. [FAIL] and non-zero UNEXPECTED_COUNT are hard fails anywhere.
# Sets globals LOG_RED (0=green,1=red) and LOG_REASON.
# ---------------------------------------------------------------------------
test_log_says_red() { # $1=logpath
    local f="$1" v reasons=() joined="" r cov req
    LOG_RED=0; LOG_REASON=""

    if [ ! -f "$f" ]; then
        LOG_RED=1; LOG_REASON="log file missing"; return
    fi

    v="$(grep -E '^EXIT=[0-9]+[[:space:]]*$' "$f" 2>/dev/null | tail -n1 | sed -E 's/^EXIT=([0-9]+).*/\1/')"
    [ -n "$v" ] && [ "$v" != "0" ] && reasons+=("final EXIT=$v")

    v="$(grep -E '^STATUS=[A-Za-z0-9_]+[[:space:]]*$' "$f" 2>/dev/null | tail -n1 | sed -E 's/^STATUS=([A-Za-z0-9_]+).*/\1/')"
    [ -n "$v" ] && [ "$v" != "DONE" ] && reasons+=("final STATUS=$v")

    grep -Eq '^[[:space:]]*\[FAIL\]' "$f" 2>/dev/null && reasons+=("[FAIL] marker")

    if grep -E '^UNEXPECTED_COUNT=[0-9]+' "$f" 2>/dev/null \
        | sed -E 's/^UNEXPECTED_COUNT=([0-9]+).*/\1/' | grep -qvE '^0$'; then
        reasons+=("UNEXPECTED_COUNT")
    fi

    v="$(grep -E '^COMMIT_EXIT=[0-9]+[[:space:]]*$' "$f" 2>/dev/null | tail -n1 | sed -E 's/^COMMIT_EXIT=([0-9]+).*/\1/')"
    [ -n "$v" ] && [ "$v" != "0" ] && reasons+=("commit failed (COMMIT_EXIT=$v)")

    cov="$(grep -E '^PARITY_COVERED=[0-9]+' "$f" 2>/dev/null | head -n1 | sed -E 's/^PARITY_COVERED=([0-9]+).*/\1/')"
    if [ -n "$cov" ]; then
        req="$(grep -E '^PARITY_REQUIRED=[0-9]+' "$f" 2>/dev/null | head -n1 | sed -E 's/^PARITY_REQUIRED=([0-9]+).*/\1/')"
        if [ -n "$req" ] && [ "$cov" -lt "$req" ]; then
            reasons+=("parity gap (COVERED=$cov < REQUIRED=$req)")
        fi
    fi

    if [ ${#reasons[@]} -gt 0 ]; then
        for r in "${reasons[@]}"; do
            if [ -z "$joined" ]; then joined="$r"; else joined="$joined, $r"; fi
        done
        LOG_RED=1; LOG_REASON="$joined"
    fi
}

# ---------------------------------------------------------------------------
# Self-test (--self-test): prove test_log_says_red flags red and passes green.
# ---------------------------------------------------------------------------
run_self_test() {
    local fails=0 tmp f
    tmp="$(mktemp -d 2>/dev/null || mktemp -d -t runner-selftest)"

    assert_red() { # $1=name $2=body $3=expectRed(0/1)
        local name="$1" body="$2" expect="$3" ok verdict
        f="$tmp/$name.log"
        printf '%b' "$body" > "$f"
        test_log_says_red "$f"
        if [ "$LOG_RED" -eq "$expect" ]; then ok=1; verdict="PASS"; else ok=0; verdict="FAIL"; fi
        printf "  [%s] %-12s -> isRed=%s (expected %s) reason='%s'\n" \
            "$verdict" "$name" "$LOG_RED" "$expect" "$LOG_REASON"
        [ "$ok" -eq 0 ] && fails=$((fails + 1))
    }

    printf '%sTest-LogSaysRed self-test:%s\n' "$C_CYAN" "$C_RESET"
    assert_red blocked      "STATUS=BLOCKED"                                              1
    assert_red exit-nonzero "EXIT=1\nSTATUS=DONE"                                         1
    assert_red fail-marker  "[FAIL] something broke\nEXIT=0"                              1
    assert_red commit-fail  "COMMIT_EXIT=1\nEXIT=0\nSTATUS=DONE"                          1
    assert_red parity-gap   "PARITY_REQUIRED=10\nPARITY_COVERED=7\nEXIT=0\nSTATUS=DONE"   1
    assert_red green        "PARITY_REQUIRED=10\nPARITY_COVERED=10\nCOMMIT_EXIT=0\nEXIT=0\nSTATUS=DONE" 0

    test_log_says_red "$tmp/does-not-exist.log"
    if [ "$LOG_RED" -eq 1 ]; then
        printf "  [PASS] %-12s -> isRed=1 (expected 1)\n" "log-missing"
    else
        printf "  [FAIL] %-12s -> isRed=0 (expected 1)\n" "log-missing"
        fails=$((fails + 1))
    fi

    rm -rf "$tmp" 2>/dev/null
    printf '\nSELFTEST_EXIT=%s\n' "$fails"
    if [ "$fails" -eq 0 ]; then
        printf '%sSTATUS=DONE%s\n' "$C_GREEN" "$C_RESET"; exit 0
    else
        printf '%sSTATUS=BLOCKED%s\n' "$C_RED" "$C_RESET"; exit 1
    fi
}

# ---------------------------------------------------------------------------
# run_prompt — launch copilot with the prompt on stdin, enforce a timeout.
# Sets globals RUN_EXIT and RUN_TIMED_OUT.
# ---------------------------------------------------------------------------
spinner_and_watchdog() { # $1=pid $2=timeout_sec $3=timeout_flag_file
    local pid="$1" timeout_sec="$2" tflag="$3"
    local elapsed=0 i=0 spin='|/-\' m s pct filled
    [ "$timeout_sec" -lt 1 ] && timeout_sec=1
    while :; do
        if [ "$elapsed" -ge "$timeout_sec" ]; then
            : > "$tflag"
            kill_tree "$pid" TERM
            sleep 2
            kill_tree "$pid" KILL
            return
        fi
        if [ -z "${QUIET_WATCHDOG:-}" ]; then
            m=$((elapsed / 60)); s=$((elapsed % 60))
            pct=$((elapsed * 100 / timeout_sec)); [ "$pct" -gt 99 ] && pct=99
            filled=$((pct / 5))
            printf '\r  %s [%s%s] %dm %ds elapsed - Copilot is working...   ' \
                "${spin:$((i % 4)):1}" "$(repeat '#' "$filled")" "$(repeat '.' "$((20 - filled))")" "$m" "$s"
        fi
        sleep 3; elapsed=$((elapsed + 3)); i=$((i + 1))
    done
}

run_prompt() { # $1=prompt fullpath  $2=logfile
    local promptpath="$1" logfile="$2" pid helper tflag timeout_sec
    RUN_EXIT=0; RUN_TIMED_OUT=0
    timeout_sec=$((TIMEOUT_MINUTES * 60)); [ "$timeout_sec" -lt 1 ] && timeout_sec=1
    tflag="$(mktemp 2>/dev/null || echo "$LOG_DIR/.timeout.$$")"
    rm -f "$tflag"

    ( cd "${RUN_CWD:-$REPO_ROOT}" && exec "$COPILOT_BIN" "${COPILOT_ARGS[@]}" ) < "$promptpath" > "$logfile" 2>&1 &
    pid=$!

    spinner_and_watchdog "$pid" "$timeout_sec" "$tflag" &
    helper=$!

    wait "$pid" 2>/dev/null
    RUN_EXIT=$?

    kill "$helper" 2>/dev/null
    wait "$helper" 2>/dev/null
    [ -z "${QUIET_WATCHDOG:-}" ] && printf '\n'

    if [ -f "$tflag" ]; then RUN_TIMED_OUT=1; RUN_EXIT=124; fi
    rm -f "$tflag" 2>/dev/null
}

# ===========================================================================
# Parallel mode (--jobs N): run N agents concurrently, each isolated in its
# own git worktree, consolidating every green result onto a single dedicated
# integration branch (parallel/<run-id>) so the user's main checkout is never
# touched mid-run. At the end the launch branch is fast-forwarded onto that
# integration branch when it can be done safely; otherwise the integration
# branch is reported for the user to merge.
#
# IMPORTANT: parallel mode does NOT enforce the strict prompt dependency
# ordering that sequential mode guarantees. Workers fork from the *current*
# integration tip (so later workers see already-merged results), but prompts
# dispatched together cannot see each other's commits. Use it for batches of
# largely-independent prompts; keep --jobs modest. Default remains 1.
# ===========================================================================

# mkdir-based mutex for short git-admin critical sections. Stores the owner pid
# so a lock left by a SIGKILLed worker (no EXIT trap) can be reclaimed once that
# pid is proven dead. Two distinct locks exist: the parent's whole-run lock and
# this per-run git mutex ($PP_LOCKDIR) — they MUST never be the same path.
pp_lock() {
    local owner waited=0
    while ! mkdir "$PP_LOCKDIR" 2>/dev/null; do
        owner="$(cat "$PP_LOCKDIR/pid" 2>/dev/null)"
        if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
            # Holder died (e.g. watchdog-killed mid-section) — reclaim the lock.
            rm -rf "$PP_LOCKDIR" 2>/dev/null
            continue
        fi
        sleep 0.2
        waited=$((waited + 1))
        # Hard ceiling (~5 min): a live-but-wedged holder must never be able to
        # stall the whole run forever. Force-break and re-contend.
        if [ "$waited" -ge 1500 ]; then
            rm -rf "$PP_LOCKDIR" 2>/dev/null
            waited=0
        fi
    done
    echo "$$" > "$PP_LOCKDIR/pid" 2>/dev/null
}
pp_unlock() {
    # Only release if we still own it (guards against a reclaimed-stale race).
    [ "$(cat "$PP_LOCKDIR/pid" 2>/dev/null)" = "$$" ] && rm -rf "$PP_LOCKDIR" 2>/dev/null
    return 0
}

# Verify the integration worktree is clean (no in-progress merge, no dirty tree).
pp_integration_is_clean() {
    [ -f "$PP_INT_WT/.git" ] || [ -d "$PP_INT_WT/.git" ] || return 1
    if [ -f "$PP_INT_GITDIR/MERGE_HEAD" ]; then return 1; fi
    git -C "$PP_INT_WT" diff --quiet 2>/dev/null \
        && git -C "$PP_INT_WT" diff --cached --quiet 2>/dev/null
}

# Force the integration worktree back to a known-good state. A single conflicted
# or half-applied merge must NEVER be allowed to poison every subsequent merge
# (the original code latched a permanent INTEGRATION_FATAL flag that discarded
# hundreds of otherwise-green prompts). Recover in place instead: abort any merge,
# hard-reset to HEAD, and drop untracked leftovers. Caller re-checks cleanliness.
pp_integration_recover() {
    git -C "$PP_INT_WT" -c gc.auto=0 merge --abort      >/dev/null 2>&1
    git -C "$PP_INT_WT" -c gc.auto=0 reset --hard HEAD   >/dev/null 2>&1
    git -C "$PP_INT_WT" -c gc.auto=0 clean -fd           >/dev/null 2>&1
    return 0
}

# ---------------------------------------------------------------------------
# worker_main — runs as a standalone re-invocation: bash "$SELF" --worker N.
# Reads its assignment from the parent-written manifest (line N), does the full
# isolated lifecycle, and records its verdict to $PP_STATE/<N>.status.
# All shared state arrives via exported PP_* env (the re-invocation does not
# re-parse the parent's CLI flags).
# ---------------------------------------------------------------------------
worker_main() { # $1 = manifest line number (1-based)
    local n="$1" line relpath label full leaf
    # Map PP_* env onto the globals the shared helpers rely on.
    REPO_ROOT="$PP_REPO_ROOT"; LOG_DIR="$PP_LOG_DIR"; DONE_FILE="$PP_DONE_FILE"
    RUN_LOG="$PP_RUN_LOG"; TIMEOUT_MINUTES="$PP_TIMEOUT_MIN"; MODEL="$PP_MODEL"
    COPILOT_BIN="$PP_COPILOT_BIN"; QUIET_WATCHDOG=1

    local status="$PP_STATE/$n.status" verdict="ERROR" reason="" slot base
    slot="$PP_WT_ROOT/slot-$n"

    # If we die before writing a real status, leave a CRASH marker + best-effort
    # worktree cleanup so the parent never silently loses a slot.
    _worker_cleanup() {
        [ -f "$status" ] || printf 'CRASH\t%s\t%s\n' "${relpath:-?}" "worker exited without verdict" > "$status"
        pp_unlock
    }
    trap '_worker_cleanup' EXIT
    trap 'exit 143' TERM INT

    line="$(sed -n "${n}p" "$PP_MANIFEST" 2>/dev/null)"
    if [ -z "$line" ]; then
        printf 'ERROR\t?\tmanifest line %s empty\n' "$n" > "$status"; return
    fi
    IFS="$TAB" read -r relpath label full leaf <<< "$line"

    # --- create the slot worktree, forked from the CURRENT integration tip ----
    pp_lock
    base="$(git -C "$PP_INT_WT" rev-parse HEAD 2>/dev/null)"
    git -C "$PP_REPO_ROOT" -c gc.auto=0 worktree add --detach "$slot" "$base" >/dev/null 2>"$PP_STATE/$n.wt.err"
    local wt_rc=$?
    if [ "$wt_rc" -ne 0 ]; then
        git -C "$PP_REPO_ROOT" -c gc.auto=0 branch -f "auto/$PP_RUN_ID/$n" "$base" >/dev/null 2>&1
        git -C "$PP_REPO_ROOT" -c gc.auto=0 worktree add "$slot" "auto/$PP_RUN_ID/$n" >/dev/null 2>"$PP_STATE/$n.wt.err"
        wt_rc=$?
    else
        git -C "$slot" -c gc.auto=0 checkout -b "auto/$PP_RUN_ID/$n" >/dev/null 2>&1
    fi
    pp_unlock
    if [ "$wt_rc" -ne 0 ]; then
        printf 'ERROR\t%s\tworktree add failed: %s\n' "$relpath" "$(tr '\n' ' ' < "$PP_STATE/$n.wt.err" 2>/dev/null)" > "$status"
        return
    fi

    # --- run the agent inside the slot ---------------------------------------
    local logfile artifact
    logfile="$PP_LOG_DIR/parallel-$PP_RUN_ID-$(printf '%04d' "$n")-$label.log"
    [ -n "$leaf" ] && artifact="$slot/$PP_LOG_REL/$leaf"
    [ -n "$artifact" ] && [ -f "$artifact" ] && rm -f "$artifact"

    COPILOT_ARGS=(--yolo --autopilot -s)
    [ -n "$MODEL" ] && COPILOT_ARGS+=(--model "$MODEL")
    RUN_CWD="$slot" run_prompt "$full" "$logfile"

    # preserve the artifact log before the worktree is removed
    if [ -n "$artifact" ] && [ -f "$artifact" ]; then
        cp "$artifact" "$PP_LOG_DIR/artifact-$PP_RUN_ID-$(printf '%04d' "$n")-$label.log" 2>/dev/null
    fi

    # --- decide a verdict -----------------------------------------------------
    if [ "$RUN_TIMED_OUT" -eq 1 ]; then
        verdict="TIMEOUT"; reason="timed out after ${TIMEOUT_MINUTES}m"
    elif [ "$RUN_EXIT" -ne 0 ]; then
        verdict="RED"; reason="exit $RUN_EXIT"
    else
        local gate=""
        test_log_says_red "$logfile"
        [ "$LOG_RED" -eq 1 ] && gate="transcript: $LOG_REASON"
        if [ -n "$artifact" ]; then
            test_log_says_red "$artifact"
            [ "$LOG_RED" -eq 1 ] && { [ -n "$gate" ] && gate="$gate; "; gate="${gate}artifact: $LOG_REASON"; }
        fi
        if [ -n "$gate" ]; then
            verdict="RED"; reason="$gate"
        elif [ "$(git -C "$slot" rev-list --count "$base"..HEAD 2>/dev/null || echo 0)" -eq 0 ]; then
            verdict="NOCOMMIT"; reason="green log but no commit on top of base"
        else
            verdict="GREEN"; reason=""
        fi
    fi

    # --- merge GREEN into the integration branch -----------------------------
    # A conflict or unclean tree fails ONLY this prompt — never the whole run.
    # We self-heal the integration worktree before and after each attempt so one
    # bad merge can't cascade into hundreds of false BLOCKEDs.
    if [ "$verdict" = "GREEN" ]; then
        pp_lock
        pp_integration_is_clean || pp_integration_recover
        if ! pp_integration_is_clean; then
            verdict="BLOCKED"; reason="integration worktree unrecoverable — merge skipped"
        elif git -C "$PP_INT_WT" -c gc.auto=0 merge --no-ff --no-edit \
                -m "merge(parallel): $relpath" "auto/$PP_RUN_ID/$n" >>"$logfile" 2>&1; then
            grep -Fxq "$relpath" "$DONE_FILE" 2>/dev/null || printf '%s\n' "$relpath" >> "$DONE_FILE"
            verdict="MERGED"; reason=""
        else
            pp_integration_recover
            # Deterministic salvage before giving up to an expensive regenerate.
            # A generated page's new files never conflict (unique paths); only the
            # shared registry files do, and their edits are purely additive (route
            # enum cases, registration lines, namespaced string-catalog keys, ledger
            # rows). salvage_merge.py re-integrates the slot by 3-way-merging those
            # registries and union-ing the route id-lists, preserving the expensive
            # generation. It bails (non-zero) on anything unexpected, leaving the
            # worktree clean for the normal CONFLICT fallback below. Disable with
            # PP_SALVAGE=0.
            if [ "${PP_SALVAGE:-1}" = "1" ] && pp_integration_is_clean \
               && python3 "$(dirname "$SELF")/salvage_merge.py" \
                    --worktree "$PP_INT_WT" --theirs "auto/$PP_RUN_ID/$n" \
                    --message "merge(parallel salvage): $relpath" >>"$logfile" 2>&1; then
                grep -Fxq "$relpath" "$DONE_FILE" 2>/dev/null || printf '%s\n' "$relpath" >> "$DONE_FILE"
                verdict="MERGED"; reason="salvaged"
            else
                pp_integration_recover
                verdict="CONFLICT"; reason="merge conflict into integration branch"
            fi
        fi
        pp_unlock
    fi

    # --- cleanup: remove worktree; prune slot branch unless it holds unmerged
    #     work worth keeping for forensics (e.g. a real merge conflict). -------
    if [ "$KEEP_WORKTREES" -ne 1 ]; then
        local ahead=0
        if [ "$verdict" != "MERGED" ]; then
            ahead="$(git -C "$PP_REPO_ROOT" rev-list --count "$base".."auto/$PP_RUN_ID/$n" 2>/dev/null || echo 0)"
        fi
        pp_lock
        git -C "$PP_REPO_ROOT" -c gc.auto=0 worktree remove --force "$slot" >/dev/null 2>&1
        if [ "$verdict" = "MERGED" ] || [ "$ahead" -eq 0 ]; then
            git -C "$PP_REPO_ROOT" -c gc.auto=0 branch -D "auto/$PP_RUN_ID/$n" >/dev/null 2>&1
        fi
        pp_unlock
    fi

    printf '%s\t%s\t%s\n' "$verdict" "$relpath" "$reason" > "$status"
    trap - EXIT
}

# ---------------------------------------------------------------------------
# run_parallel — the parent orchestrator for --jobs N.
# ---------------------------------------------------------------------------
run_parallel() {
    local launch_branch base_tip int_wt int_branch int_gitdir runlock state wt_root manifest
    local cores; cores="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

    if ! command -v "$COPILOT_BIN" >/dev/null 2>&1; then
        echo "${C_RED}ERROR: agent binary '$COPILOT_BIN' not found on PATH.${C_RESET}" >&2; return 1
    fi
    if [ "$JOBS" -gt 8 ]; then
        echo "${C_YELLOW}WARNING: --jobs $JOBS is aggressive. Each worker may spawn a full" >&2
        echo "         xcodebuild/gradle build; concurrent agents also share ~/.copilot state." >&2
        echo "         Recommended: 4-8 (this host reports $cores cores). Continuing in 5s...${C_RESET}" >&2
        sleep 5
    fi

    launch_branch="$(git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null)"
    if [ -z "$launch_branch" ]; then
        echo "${C_RED}ERROR: main checkout is in detached HEAD; parallel mode needs a branch.${C_RESET}" >&2; return 1
    fi
    base_tip="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null)"

    # Preflight (warnings only — main tree is not touched until final FF).
    if ! git -C "$REPO_ROOT" diff --quiet 2>/dev/null || ! git -C "$REPO_ROOT" diff --cached --quiet 2>/dev/null; then
        echo "${C_YELLOW}NOTE: main checkout has uncommitted changes; the launch branch will only" >&2
        echo "      be fast-forwarded at the end if git can do so without clobbering them.${C_RESET}" >&2
    fi

    # Whole-run lock (DISTINCT from the per-run git mutex used by workers).
    runlock="$LOG_DIR/.parallel-run.lock"
    if ! mkdir "$runlock" 2>/dev/null; then
        local rowner; rowner="$(cat "$runlock/pid" 2>/dev/null)"
        if [ "$FORCE" -eq 1 ] || { [ -n "$rowner" ] && ! kill -0 "$rowner" 2>/dev/null; }; then
            rm -rf "$runlock" 2>/dev/null; mkdir "$runlock" 2>/dev/null
        else
            echo "${C_RED}ERROR: another parallel run holds $runlock (pid $rowner). Use --force to override.${C_RESET}" >&2
            return 1
        fi
    fi
    echo "$$" > "$runlock/pid"

    RUN_ID="$(date '+%Y%m%d-%H%M%S')-$$"
    state="$LOG_DIR/parallel/$RUN_ID"; mkdir -p "$state"
    wt_root="$(dirname "$REPO_ROOT")/.teslasync-parallel/$RUN_ID"; mkdir -p "$wt_root"
    int_branch="parallel/$RUN_ID"
    int_wt="$wt_root/integration"
    manifest="$state/manifest"

    # Build the pending-prompt manifest.
    local m=0 idx=0 i1 leaf art
    : > "$manifest"
    while [ "$idx" -lt "$TOTAL" ]; do
        i1=$((idx + 1)); idx=$((idx + 1))
        is_done "${P_RELPATH[$((i1-1))]}" && continue
        [ "$i1" -lt "$START_FROM" ] && continue
        [ -f "${P_FULLPATH[$((i1-1))]}" ] || continue
        art="$(get_artifact_log_path "${P_FULLPATH[$((i1-1))]}")"
        leaf=""; [ -n "$art" ] && leaf="$(basename "$art")"
        printf '%s\t%s\t%s\t%s\n' "${P_RELPATH[$((i1-1))]}" "${P_LABEL[$((i1-1))]}" "${P_FULLPATH[$((i1-1))]}" "$leaf" >> "$manifest"
        m=$((m + 1))
    done

    if [ "$m" -eq 0 ]; then
        echo "${C_GREEN}Nothing pending — all prompts already done.${C_RESET}"
        rm -rf "$runlock" 2>/dev/null; return 0
    fi

    # Create the integration worktree/branch from the launch tip.
    if ! git -C "$REPO_ROOT" -c gc.auto=0 worktree add -b "$int_branch" "$int_wt" "$base_tip" >/dev/null 2>"$state/int.err"; then
        echo "${C_RED}ERROR: could not create integration worktree: $(cat "$state/int.err" 2>/dev/null)${C_RESET}" >&2
        rm -rf "$runlock" 2>/dev/null; return 1
    fi
    int_gitdir="$(git -C "$int_wt" rev-parse --git-dir 2>/dev/null)"
    case "$int_gitdir" in /*) : ;; *) int_gitdir="$int_wt/$int_gitdir" ;; esac

    echo ""
    echo "${C_CYAN}================================================================${C_RESET}"
    echo "${C_CYAN}  PARALLEL MODE${C_RESET}"
    echo "${C_CYAN}================================================================${C_RESET}"
    echo "  Jobs            : $JOBS concurrent"
    echo "  Pending prompts : $m"
    echo "  Launch branch   : $launch_branch ($(printf '%.10s' "$base_tip"))"
    echo "  Integration     : $int_branch"
    echo "  Worktrees       : $wt_root"
    echo "  State           : $state"
    echo "  Agent binary    : $COPILOT_BIN"
    echo "  ${C_YELLOW}Note: parallel mode does not enforce strict prompt ordering.${C_RESET}"
    echo "${C_CYAN}================================================================${C_RESET}"
    echo ""

    # Export everything workers need, then dispatch via xargs -P.
    export PP_REPO_ROOT="$REPO_ROOT" PP_LOG_DIR="$LOG_DIR" PP_DONE_FILE="$DONE_FILE"
    export PP_RUN_LOG="$RUN_LOG" PP_STATE="$state" PP_MANIFEST="$manifest"
    export PP_INT_WT="$int_wt" PP_INT_GITDIR="$int_gitdir" PP_INT_BRANCH="$int_branch"
    export PP_WT_ROOT="$wt_root" PP_RUN_ID="$RUN_ID" PP_LOCKDIR="$state/git-mutex.lock"
    export PP_BASE_TIP="$base_tip" PP_MODEL="$MODEL" PP_TIMEOUT_MIN="$TIMEOUT_MINUTES"
    export PP_COPILOT_BIN="$COPILOT_BIN" PP_LOG_REL=".github/prompts/monorepo/logs"
    export KEEP_WORKTREES TAB

    local xargs_pid
    seq 1 "$m" | xargs -P "$JOBS" -I {} bash "$SELF" --worker {} &
    xargs_pid=$!

    # Parent trap: on interruption, tear down workers + worktrees + locks.
    trap '
        echo "'"$C_YELLOW"'Interrupted — stopping workers and cleaning up...'"$C_RESET"'" >&2
        kill_tree "'"$xargs_pid"'" TERM 2>/dev/null
        sleep 2; kill_tree "'"$xargs_pid"'" KILL 2>/dev/null
    ' INT TERM

    wait "$xargs_pid" 2>/dev/null
    trap - INT TERM

    # --- aggregate verdicts ---------------------------------------------------
    local greens=0 reds=0 n2 v rp rs st
    RES_ID=(); RES_RED=(); RES_REASON=()
    n2=1
    while [ "$n2" -le "$m" ]; do
        st="$state/$n2.status"
        if [ -f "$st" ]; then
            IFS="$TAB" read -r v rp rs < "$st"
        else
            v="CRASH"; rp="$(sed -n "${n2}p" "$manifest" | cut -f1)"; rs="no status file"
        fi
        RES_ID+=("$rp")
        if [ "$v" = "MERGED" ]; then
            RES_RED+=(0); RES_REASON+=("merged"); greens=$((greens + 1))
        else
            RES_RED+=(1); RES_REASON+=("$v: $rs"); reds=$((reds + 1))
        fi
        n2=$((n2 + 1))
    done

    # --- final consolidation onto the launch branch --------------------------
    local consolidated="no" ff_out
    if git -C "$REPO_ROOT" merge-base --is-ancestor "$base_tip" "$int_branch" 2>/dev/null \
        && [ "$(git -C "$REPO_ROOT" rev-parse "$int_branch" 2>/dev/null)" != "$base_tip" ]; then
        ff_out="$(git -C "$REPO_ROOT" -c gc.auto=0 merge --ff-only "$int_branch" 2>&1)"
        if [ $? -eq 0 ]; then
            consolidated="yes"
        else
            consolidated="manual"
        fi
    else
        consolidated="empty"
    fi

    # --- cleanup worktrees ----------------------------------------------------
    if [ "$KEEP_WORKTREES" -ne 1 ]; then
        git -C "$REPO_ROOT" -c gc.auto=0 worktree remove --force "$int_wt" >/dev/null 2>&1
        git -C "$REPO_ROOT" -c gc.auto=0 worktree prune >/dev/null 2>&1
        # The integration branch is redundant once the launch branch holds it.
        [ "$consolidated" = "yes" ] && git -C "$REPO_ROOT" -c gc.auto=0 branch -D "$int_branch" >/dev/null 2>&1
        rmdir "$wt_root" 2>/dev/null
        rmdir "$(dirname "$wt_root")" 2>/dev/null
    fi
    rm -rf "$runlock" 2>/dev/null

    # --- summary --------------------------------------------------------------
    echo ""
    echo "${C_CYAN}================================================================${C_RESET}"
    echo "${C_CYAN}  PARALLEL RUN FINISHED${C_RESET}"
    echo "${C_CYAN}================================================================${C_RESET}"
    echo "  ${C_GREEN}Merged   : $greens${C_RESET}"
    if [ "$reds" -gt 0 ]; then echo "  ${C_RED}Not green: $reds${C_RESET}"; else echo "  ${C_GREEN}Not green: 0${C_RESET}"; fi
    if [ "$consolidated" = "yes" ]; then
        echo "  ${C_GREEN}Launch branch '$launch_branch' fast-forwarded onto $int_branch.${C_RESET}"
    elif [ "$consolidated" = "manual" ]; then
        echo "  ${C_YELLOW}Could not auto-FF (main tree would be clobbered). All green work is on"
        echo "  branch '$int_branch'. Merge it when ready: git merge $int_branch${C_RESET}"
    else
        echo "  ${C_GRAY}No green merges landed; integration branch unchanged.${C_RESET}"
    fi
    echo "  State    : $state"
    echo "${C_CYAN}================================================================${C_RESET}"

    if [ ${#RES_ID[@]} -gt 0 ]; then
        echo ""
        echo "${C_CYAN}  Prompt outcomes:${C_RESET}"
        local j=0
        while [ "$j" -lt ${#RES_ID[@]} ]; do
            if [ "${RES_RED[$j]}" -eq 1 ]; then col="$C_RED"; else col="$C_GREEN"; fi
            printf '%s  %-55s %s%s\n' "$col" "${RES_ID[$j]}" "${RES_REASON[$j]}" "$C_RESET"
            j=$((j + 1))
        done
    fi

    [ "$reds" -gt 0 ] && return 1
    return 0
}

# ===========================================================================
# Self-test runs standalone and exits.
# ===========================================================================
if [ "$SELF_TEST" -eq 1 ]; then run_self_test; fi

# ===========================================================================
# Worker re-invocation (--worker N) short-circuits here: it does not run
# discovery or the orchestrator body; it reads its assignment from PP_* env.
# ===========================================================================
if [ -n "$WORKER_IDX" ]; then worker_main "$WORKER_IDX"; exit 0; fi

# ---------------------------------------------------------------------------
# Validate environment
# ---------------------------------------------------------------------------
if [ ! -d "$PROMPTS_ROOT" ]; then
    echo "${C_RED}ERROR: monorepo prompts root not found: $PROMPTS_ROOT${C_RESET}" >&2
    exit 1
fi
mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------------------
# Discover program directories (p*-*) in numeric order
# ---------------------------------------------------------------------------
PROGRAM_DIRS=()
if [ -n "$PROGRAM" ]; then
    if [ ! -d "$PROMPTS_ROOT/$PROGRAM" ]; then
        echo "${C_RED}ERROR: Program directory not found: $PROMPTS_ROOT/$PROGRAM${C_RESET}" >&2
        echo "${C_YELLOW}Available programs:${C_RESET}" >&2
        for d in "$PROMPTS_ROOT"/p*-*/; do [ -d "$d" ] && echo "  $(basename "$d")"; done
        exit 1
    fi
    PROGRAM_DIRS+=("$PROMPTS_ROOT/$PROGRAM")
else
    while IFS="$TAB" read -r _num dpath; do
        [ -n "$dpath" ] && PROGRAM_DIRS+=("$dpath")
    done < <(
        for d in "$PROMPTS_ROOT"/p*-*/; do
            [ -d "$d" ] || continue
            d="${d%/}"
            bn="$(basename "$d")"
            if [[ "$bn" =~ ^p([0-9]+)- ]]; then num="${BASH_REMATCH[1]}"; else num=9999; fi
            printf '%s\t%s\n' "$num" "$d"
        done | LC_ALL=C sort -t"$TAB" -k1,1n -k2,2
    )
fi

if [ ${#PROGRAM_DIRS[@]} -eq 0 ]; then
    echo "${C_RED}ERROR: No p*-* program directories found under $PROMPTS_ROOT${C_RESET}" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Build the ordered prompt list across all program dirs (recursive)
# ---------------------------------------------------------------------------
P_FULLPATH=(); P_LABEL=(); P_PROGRAM=(); P_RELPATH=()
N=0
for pd in "${PROGRAM_DIRS[@]}"; do
    prog="$(basename "$pd")"
    sorted="$(
        find "$pd" -type f -name '*.prompt.md' 2>/dev/null | while IFS= read -r f; do
            compute_sort_key "$f" "$pd"
        done | LC_ALL=C sort -t"$SEP" -k1,1 -k2,2n -k3,3 -k4,4n -k5,5
    )"
    [ -z "$sorted" ] && continue
    while IFS="$SEP" read -r _l _p _d _s name fullpath; do
        [ -z "$fullpath" ] && continue
        P_FULLPATH[$N]="$fullpath"
        P_LABEL[$N]="$name"
        P_PROGRAM[$N]="$prog"
        P_RELPATH[$N]="${fullpath#"$PROMPTS_ROOT/"}"
        N=$((N + 1))
    done <<< "$sorted"
done

# Narrow to a single prompt by filename if requested
if [ -n "$SINGLE" ]; then
    nF=(); nL=(); nP=(); nR=(); found=0; k=0
    while [ "$k" -lt "$N" ]; do
        if [ "$(basename "${P_RELPATH[$k]}")" = "$SINGLE" ]; then
            nF+=("${P_FULLPATH[$k]}"); nL+=("${P_LABEL[$k]}")
            nP+=("${P_PROGRAM[$k]}"); nR+=("${P_RELPATH[$k]}"); found=1
        fi
        k=$((k + 1))
    done
    if [ "$found" -eq 0 ]; then
        echo "${C_RED}ERROR: No prompt named '$SINGLE' under any program directory.${C_RESET}" >&2
        exit 1
    fi
    P_FULLPATH=("${nF[@]}"); P_LABEL=("${nL[@]}"); P_PROGRAM=("${nP[@]}"); P_RELPATH=("${nR[@]}")
    N=${#P_FULLPATH[@]}
fi

TOTAL=$N
if [ "$TOTAL" -eq 0 ]; then
    echo "${C_RED}ERROR: No .prompt.md files discovered.${C_RESET}" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# done.txt setup
# ---------------------------------------------------------------------------
if [ "$RESET" -eq 1 ]; then
    rm -f "$DONE_FILE"
    echo "${C_YELLOW}Reset: cleared done.txt${C_RESET}"
fi
[ -f "$DONE_FILE" ] || : > "$DONE_FILE"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
doneCount=0; idx=0
while [ "$idx" -lt "$TOTAL" ]; do
    is_done "${P_RELPATH[$idx]}" && doneCount=$((doneCount + 1))
    idx=$((idx + 1))
done
pendingCount=$((TOTAL - doneCount))

progNames=""
for pd in "${PROGRAM_DIRS[@]}"; do
    bn="$(basename "$pd")"
    if [ -z "$progNames" ]; then progNames="$bn"; else progNames="$progNames, $bn"; fi
done

echo ""
echo "${C_CYAN}================================================================${C_RESET}"
echo "${C_CYAN}  TeslaSync — monorepo Native Apps Master Runner${C_RESET}"
echo "${C_CYAN}================================================================${C_RESET}"
echo "  Prompts root  : $PROMPTS_ROOT"
echo "  Programs      : ${#PROGRAM_DIRS[@]} ($progNames)"
echo "  Total prompts : $TOTAL"
echo "  ${C_GRAY}Already done  : $doneCount${C_RESET}"
echo "  ${C_GREEN}Pending       : $pendingCount${C_RESET}"
echo "  Starting from : #$START_FROM"
echo "  Single        : $([ -n "$SINGLE" ] && echo "$SINGLE" || echo '(all)')"
echo "  Model         : $([ -n "$MODEL" ] && echo "$MODEL" || echo '(default)')"
echo "  Timeout       : $TIMEOUT_MINUTES min per prompt"
echo "  Dry run       : $([ "$DRY_RUN" -eq 1 ] && echo 'True' || echo 'False')"
echo "  ${C_YELLOW}Log-gate      : EXIT!=0 / STATUS=BLOCKED / [FAIL] / UNEXPECTED_COUNT -> RED${C_RESET}"
echo "  Run log       : $RUN_LOG"
echo "${C_CYAN}================================================================${C_RESET}"
echo ""

# ---------------------------------------------------------------------------
# Dry run — list planned execution order and exit
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
    echo "${C_YELLOW}DRY RUN — listing planned execution order:${C_RESET}"
    curProg=""; idx=0
    while [ "$idx" -lt "$TOTAL" ]; do
        i1=$((idx + 1))
        if [ "${P_PROGRAM[$idx]}" != "$curProg" ]; then
            curProg="${P_PROGRAM[$idx]}"
            echo ""
            echo "${C_CYAN}── $curProg ──${C_RESET}"
        fi
        if is_done "${P_RELPATH[$idx]}"; then marker="DONE"
        elif [ "$i1" -lt "$START_FROM" ]; then marker="SKIP"
        else marker="    "; fi
        printf '  %s [%4d/%d] %s\n' "$marker" "$i1" "$TOTAL" "${P_RELPATH[$idx]}"
        idx=$((idx + 1))
    done
    echo ""
    exit 0
fi

# ---------------------------------------------------------------------------
# Parallel mode (--jobs N>1): dispatch via worktrees, then exit.
# ---------------------------------------------------------------------------
case "$JOBS" in ''|*[!0-9]*) JOBS=1 ;; esac
if [ "$JOBS" -gt 1 ]; then
    run_parallel
    exit $?
fi

# ---------------------------------------------------------------------------
# Ensure the agent binary is available before executing
# ---------------------------------------------------------------------------
if ! command -v "$COPILOT_BIN" >/dev/null 2>&1; then
    echo "${C_RED}ERROR: agent binary '$COPILOT_BIN' not found on PATH. Install it or use --dry-run.${C_RESET}" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Execute prompts sequentially
# ---------------------------------------------------------------------------
successCount=0; failCount=0; skipCount=0; curProg=""
RES_ID=(); RES_RED=(); RES_REASON=()

idx=0
while [ "$idx" -lt "$TOTAL" ]; do
    i1=$((idx + 1))
    prog="${P_PROGRAM[$idx]}"; label="${P_LABEL[$idx]}"
    relpath="${P_RELPATH[$idx]}"; full="${P_FULLPATH[$idx]}"
    idx=$((idx + 1))

    if [ "$prog" != "$curProg" ]; then
        curProg="$prog"
        printf '\n%s>>> Entering program: %s <<<%s\n\n' "$C_MAGENTA" "$prog" "$C_RESET"
    fi

    tag="[$i1/$TOTAL]"

    if is_done "$relpath"; then
        printf '%s%s DONE  %s%s\n' "$C_GRAY" "$tag" "$label" "$C_RESET"
        skipCount=$((skipCount + 1)); continue
    fi
    if [ "$i1" -lt "$START_FROM" ]; then
        printf '%s%s SKIP  %s (before StartFrom)%s\n' "$C_GRAY" "$tag" "$label" "$C_RESET"
        skipCount=$((skipCount + 1)); continue
    fi
    if [ ! -f "$full" ]; then
        log "$tag MISSING  $full"
        printf '%s  File not found! Skipping.%s\n' "$C_RED" "$C_RESET"
        failCount=$((failCount + 1)); continue
    fi

    logfile="$LOG_DIR/prompt-$(printf '%04d' "$i1")-$label.log"
    artifactlog="$(get_artifact_log_path "$full")"

    echo ""
    echo "${C_CYAN}----------------------------------------------------------${C_RESET}"
    printf '%s%s %s/%s%s\n' "$C_GREEN" "$tag" "$prog" "$label" "$C_RESET"
    printf '  Prompt    : %s%s%s\n' "$C_DKYEL" "$relpath" "$C_RESET"
    printf '  Log       : %s\n' "$logfile"
    [ -n "$artifactlog" ] && printf '  Artifact  : %s\n' "$artifactlog"
    echo "${C_CYAN}----------------------------------------------------------${C_RESET}"

    COPILOT_ARGS=(--yolo --autopilot -s)
    [ -n "$MODEL" ] && COPILOT_ARGS+=(--model "$MODEL")

    start_ts=$(date +%s)
    log "$tag START  $relpath"

    if [ -n "$artifactlog" ] && [ -f "$artifactlog" ]; then
        rm -f "$artifactlog"
        log "$tag Cleared stale artifact log $artifactlog"
    fi

    run_prompt "$full" "$logfile"
    exit_code=$RUN_EXIT

    [ -s "$logfile" ] && cat "$logfile"

    end_ts=$(date +%s)
    mins=$(awk "BEGIN{printf \"%.1f\", ($end_ts-$start_ts)/60}")

    if [ "$RUN_TIMED_OUT" -eq 1 ]; then
        log "$tag TIMEOUT after $TIMEOUT_MINUTES min - force stopped"
        printf '%s  TIMEOUT - killed session%s\n' "$C_RED" "$C_RESET"
    fi

    if [ "$exit_code" -ne 0 ]; then
        failCount=$((failCount + 1))
        RES_ID+=("$relpath"); RES_RED+=(1); RES_REASON+=("exit $exit_code")
        log "$tag FAILED (exit $exit_code) after $mins min"
        echo ""
        printf '%s  FAILED after %s min (exit code %s)%s\n' "$C_RED" "$mins" "$exit_code" "$C_RESET"
        printf '%s  Log: %s%s\n' "$C_RED" "$logfile" "$C_RESET"
        echo ""
        if [ "$CONTINUE_ON_RED" -eq 1 ]; then
            log "$tag CONTINUE-ON-RED set; advancing past red prompt"
            printf '%s  --continue-on-red set; advancing past red prompt.%s\n' "$C_YELLOW" "$C_RESET"
        else
            log "STOPPED at red prompt $i1 (exit). Resume with: --start-from $i1"
            printf '%s  STOP: red prompt. Pass --continue-on-red to override. Resume with: --start-from %s%s\n' "$C_YELLOW" "$i1" "$C_RESET"
            break
        fi
    else
        # Log-gate: even if CLI exited 0, scan transcript + artifact log for red markers.
        gateFailures=""
        test_log_says_red "$logfile"
        if [ "$LOG_RED" -eq 1 ]; then
            gateFailures="transcript log: $LOG_REASON"
        fi
        if [ -n "$artifactlog" ]; then
            test_log_says_red "$artifactlog"
            if [ "$LOG_RED" -eq 1 ]; then
                artifactRel="${artifactlog#"$REPO_ROOT/"}"
                _af="artifact log $artifactRel: $LOG_REASON"
                if [ -z "$gateFailures" ]; then gateFailures="$_af"; else gateFailures="$gateFailures; $_af"; fi
            fi
        fi

        if [ -n "$gateFailures" ]; then
            failCount=$((failCount + 1))
            RES_ID+=("$relpath"); RES_RED+=(1); RES_REASON+=("$gateFailures")
            log "$tag LOG-GATE FAILED ($gateFailures) after $mins min"
            echo ""
            printf '%s  LOG-GATE FAILED after %s min%s\n' "$C_RED" "$mins" "$C_RESET"
            printf '%s  Reason: %s%s\n' "$C_RED" "$gateFailures" "$C_RESET"
            printf '%s  CLI exited 0 but child log contains red markers.%s\n' "$C_RED" "$C_RESET"
            printf '%s  Log: %s%s\n' "$C_RED" "$logfile" "$C_RESET"
            echo ""
            # NEVER append a red prompt to done.txt — STOP unless --continue-on-red.
            if [ "$CONTINUE_ON_RED" -eq 1 ]; then
                log "$tag CONTINUE-ON-RED set; advancing past red prompt (log-gate)"
                printf '%s  --continue-on-red set; advancing past red prompt.%s\n' "$C_YELLOW" "$C_RESET"
            else
                log "STOPPED at red prompt $i1 (log-gate). Resume with: --start-from $i1"
                printf '%s  STOP: red prompt. Pass --continue-on-red to override. Resume with: --start-from %s%s\n' "$C_YELLOW" "$i1" "$C_RESET"
                break
            fi
        else
            successCount=$((successCount + 1))
            RES_ID+=("$relpath"); RES_RED+=(0); RES_REASON+=("")
            log "$tag DONE in $mins min"
            printf '%s  Completed in %s min%s\n' "$C_GREEN" "$mins" "$C_RESET"
            mark_done "$relpath"
        fi
    fi

    if [ "$DELAY_SECONDS" -gt 0 ]; then
        printf '%s  Waiting %s seconds before next prompt...%s\n' "$C_GRAY" "$DELAY_SECONDS" "$C_RESET"
        sleep "$DELAY_SECONDS"
    fi
done

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------
echo ""
echo "${C_CYAN}================================================================${C_RESET}"
echo "${C_CYAN}  FINISHED${C_RESET}"
echo "${C_CYAN}================================================================${C_RESET}"
echo "  ${C_GREEN}Succeeded : $successCount${C_RESET}"
if [ "$failCount" -gt 0 ]; then
    echo "  ${C_RED}Failed    : $failCount${C_RESET}"
else
    echo "  ${C_GREEN}Failed    : $failCount${C_RESET}"
fi
echo "  ${C_GRAY}Skipped   : $skipCount${C_RESET}"
echo "  Run log   : $RUN_LOG"
echo "  Done file : $DONE_FILE"
echo "${C_CYAN}================================================================${C_RESET}"

if [ ${#RES_ID[@]} -gt 0 ]; then
    echo ""
    echo "${C_CYAN}  Prompt outcomes:${C_RESET}"
    printf '  %-55s %-5s %s\n' 'id' 'RED?' 'reason'
    printf '  %-55s %-5s %s\n' '-------------------------------------------------------' '-----' '--------------------'
    j=0
    while [ "$j" -lt ${#RES_ID[@]} ]; do
        if [ "${RES_RED[$j]}" -eq 1 ]; then redStr="YES"; col="$C_RED"; else redStr="no"; col="$C_GREEN"; fi
        printf '%s  %-55s %-5s %s%s\n' "$col" "${RES_ID[$j]}" "$redStr" "${RES_REASON[$j]}" "$C_RESET"
        j=$((j + 1))
    done
fi

[ "$failCount" -gt 0 ] && exit 1
exit 0
