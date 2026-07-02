#!/usr/bin/env bash
#
# frontend-loop.sh — thin wrapper so the autonomous loop driver is runnable
# and discoverable directly from .github/prompts/frontend-gold-standard/,
# alongside the mission doc (0000-methodology.prompt.md), the prompt
# programs (p0-foundation/ .. p8-e2e-pages/), the parallel runner
# (run-prompts.sh), and the manifest/logs this loop produces.
#
# The single source of truth for the actual driver logic remains
# apps/tools/frontend-rewrite/frontend-loop.sh (this just execs it, so
# JOBS/MAX_STALLS env vars and all internal sibling-script references
# — self-heal-audit.mjs, gen-manifest.mjs — keep resolving correctly).
#
# Usage (identical to the real script): JOBS=4 ./frontend-loop.sh
set -o pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REAL="$SCRIPT_DIR/../../../apps/tools/frontend-rewrite/frontend-loop.sh"
exec bash "$REAL" "$@"
