# Phase-47 / Prompt 01 — Architecture baseline metrics

## Why

Phase-47 makes architectural improvements (slim main.go, decouple workers,
freeze internal/api, lock import-graph). To know whether each improvement
actually moves the needle we need a measurable **baseline** captured BEFORE
any refactor lands. Without a baseline, "we shrunk main.go" is unverifiable
and "platform/ stopped growing" is hand-wave.

This prompt is **pure additive** — zero risk to existing code, zero coupling
to phase-42. It writes a CLI tool that snapshots architectural metrics
(file counts per package, LOC of cmd/*, package-import edge count, doc.go
adoption rate) into a JSON baseline + Markdown report committed to the repo.

## Evidence

> **⚠️ Baseline numbers below are from `2026-05-04` and have drifted
> significantly. Verified `2026-05-08` deltas (4 days, no phase-47
> prompts executed, phase-42 + phase-48 landed in this window):**
>
> | Metric | May-04 | May-08 | Δ |
> |---|---|---|---|
> | `internal/api/` files | 223 | **289** | +66 (+30 %) |
> | `cmd/teslasync/main.go` lines | 726 | **1022** | +296 (+41 %) |
> | `cmd/notification-worker/main.go` lines | 343 | **400** | +57 |
> | `cmd/automation-worker/main.go` lines | 272 | **307** | +35 |
> | Worker → internal/api inversion | YES (×2) | **YES (×2)** | unfixed |
> | `tools/archmetrics` | absent | **absent** | not built |
>
> **First action on execution:** run `tools/archmetrics` (after prompt 01
> creates it) to capture the current true baseline. The May-04 numbers
> below are kept verbatim for historical reference and to avoid editing
> the original Evidence corpus, but they MUST NOT be used as the JSON
> baseline committed to `tools/archmetrics/baseline.json`.

Original state (verified `2026-05-04`):

```
internal/api/        223 .go files
internal/handler/    22  .go files (subdirs: dto/, middleware/, v1/)
internal/models/     33  .go files
internal/domain/     33  .go files (subdirs: charging/, export/, fsm/, notification/, trip/, user/, vehicle/)
internal/service/    5   .go files
internal/app/        13  .go files (subdirs: chargingsvc/, dashboardsvc/, exportsvc/, notificationsvc/, tripsvc/, vehiclesvc/)
internal/platform/   28  .go files (subdirs: buildinfo/, cache/, config/, database/, httputil/, telemetry/)
internal/adapter/    23  .go files (subdirs: gasprices/, geocoding/, mqtt/, postgres/, redis/, storage/, tesla/)
internal/port/       14  .go files (subdirs: external/, messaging/, repository/)

cmd/teslasync/main.go           726 lines  (target: ~50)
cmd/notification-worker/main.go 343 lines
cmd/automation-worker/main.go   272 lines
cmd/export-worker/main.go       172 lines
cmd/protogen-tesla/main.go      ~76 lines

Packages with doc.go: 13 of 33+ (≈40 %)

Worker → internal/api imports (LAYERING INVERSION):
  cmd/notification-worker/main.go:15
  cmd/automation-worker/main.go:17
```

`tools/archmetrics/` does not exist yet. No `arch_test.go` anywhere.

## Design

### Step 1 — `tools/archmetrics/main.go`

Standalone CLI under `tools/archmetrics/`. Compiled with the rest of the
module but never wired into a binary. Lives outside `cmd/` because it's a
developer tool, not a runtime artifact.

```go
// tools/archmetrics/main.go
//
// Usage:
//   go run ./tools/archmetrics > tools/archmetrics/baseline.json
//   go run ./tools/archmetrics -report > tools/archmetrics/baseline.md
//   go run ./tools/archmetrics -compare tools/archmetrics/baseline.json
//
// -compare exits 1 if any metric REGRESSES (new file in frozen package,
// new layering violation, doc.go coverage drops).
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type PkgMetric struct {
	Path        string   `json:"path"`         // e.g. "internal/api"
	GoFiles     int      `json:"go_files"`     // .go files (excl. _test.go)
	TestFiles   int      `json:"test_files"`   // _test.go files
	LOC         int      `json:"loc"`          // total non-blank lines
	HasDocGo    bool     `json:"has_doc_go"`
	Layer       string   `json:"layer,omitempty"` // parsed from doc.go magic comment
	Imports     []string `json:"imports"`      // unique internal/* imports
}

type Snapshot struct {
	GeneratedAt   string                `json:"generated_at"` // RFC3339
	GoVersion     string                `json:"go_version"`
	CommitSHA     string                `json:"commit_sha"`   // git rev-parse HEAD
	Packages      []PkgMetric           `json:"packages"`
	CmdLOC        map[string]int        `json:"cmd_loc"`      // cmd/<name>/main.go LOC
	ForbiddenEdges []string             `json:"forbidden_edges"` // e.g. "cmd/notification-worker -> internal/api"
	DocGoCoverage  float64              `json:"doc_go_coverage"` // 0.0–1.0
}

func main() {
	report := flag.Bool("report", false, "emit Markdown report instead of JSON")
	compare := flag.String("compare", "", "compare against baseline JSON; non-zero exit on regression")
	flag.Parse()

	snap := collect()

	switch {
	case *report:
		emitMarkdown(os.Stdout, snap)
	case *compare != "":
		base := loadBaseline(*compare)
		if regressions := diff(base, snap); len(regressions) > 0 {
			for _, r := range regressions {
				fmt.Fprintln(os.Stderr, "REGRESSION:", r)
			}
			os.Exit(1)
		}
		fmt.Println("OK: no architectural regression")
	default:
		_ = json.NewEncoder(os.Stdout).Encode(snap)
	}
}

// collect, emitMarkdown, loadBaseline, diff — implementation in spec.
```

Key implementation notes for the executor:

- **Walk roots:** `cmd/`, `internal/`, `tools/` (NOT `.github/`, `web/`, `vendor/`).
- **Layer parsing:** look for first comment in `doc.go` matching `^// Layer:\s*(\w+)$`.
  Valid values: `domain`, `port`, `adapter`, `app`, `handler`, `platform`,
  `cmd-internal`, `tool`. Unknown → empty string + warning.
- **Forbidden edges (initial set, MUST match what arch_test.go in prompt 02 enforces):**
  - `cmd/notification-worker -> internal/api`
  - `cmd/automation-worker -> internal/api`
  - `internal/domain/* -> internal/adapter/*`
  - `internal/domain/* -> internal/database`
  - `internal/handler/v1 -> internal/database`
- **CommitSHA:** call `exec.Command("git", "rev-parse", "HEAD")`; on error use `"unknown"`.

### Step 2 — write the baseline files

```bash
go run ./tools/archmetrics > tools/archmetrics/baseline.json
go run ./tools/archmetrics -report > tools/archmetrics/baseline.md
```

Both files committed. Subsequent prompts reference them (e.g. prompt 04
asserts `cmd/teslasync/main.go` LOC drops from 726 to ≤80).

### Step 3 — Makefile / npm-style invocation

Add to repo root `Makefile` (create if missing):

```makefile
.PHONY: arch-baseline arch-check
arch-baseline:
	go run ./tools/archmetrics > tools/archmetrics/baseline.json
	go run ./tools/archmetrics -report > tools/archmetrics/baseline.md

arch-check:
	go run ./tools/archmetrics -compare tools/archmetrics/baseline.json
```

If a Makefile already exists, append (don't overwrite). If it doesn't, create
with these two targets only.

### Step 4 — README under tools/archmetrics/

```markdown
# tools/archmetrics

Architecture metrics snapshotter for TeslaSync. Captures package-level file
counts, LOC, import edges, and doc.go adoption into a JSON baseline used
by `arch_test.go` (see internal/arch/) and CI.

## Update the baseline (after a deliberate refactor)

    make arch-baseline
    git add tools/archmetrics/baseline.{json,md}
    git commit -m "chore(arch): refresh baseline after <X>"

## Check for regressions (CI runs this)

    make arch-check

Non-zero exit means a new file landed in a frozen package, a new layering
violation appeared, or doc.go coverage dropped.
```

## Verification

```
1. cd D:\repos\teslasync
2. go run ./tools/archmetrics | jq '.packages | length' > NUL
   → expect a positive integer (≈30+)
3. go run ./tools/archmetrics -report | Out-File -Encoding UTF8 baseline.md
   Open baseline.md — confirm sections: Summary, Per-package metrics,
   cmd LOC, Forbidden edges, doc.go adoption.
4. go run ./tools/archmetrics > tools/archmetrics/baseline.json
5. go run ./tools/archmetrics -compare tools/archmetrics/baseline.json
   → "OK: no architectural regression" (since we just generated it)
6. Touch a file: New-Item -ItemType File internal/api/zzz_phase47_test.go;
   go run ./tools/archmetrics -compare tools/archmetrics/baseline.json
   → MUST exit non-zero with "REGRESSION: new file in internal/api/zzz_phase47_test.go".
   Then DELETE the test file before commit.
7. make arch-baseline (or invoke the 2 commands manually) — confirm both
   .json and .md files are written.
```

## Files touched

```
ADDED:
  tools/archmetrics/main.go
  tools/archmetrics/baseline.json
  tools/archmetrics/baseline.md
  tools/archmetrics/README.md
  Makefile (created if missing; otherwise APPENDED with arch-baseline + arch-check targets)

MODIFIED:
  (none)

DELETED:
  (none)
```

## Out of scope

- Wiring `arch-check` into CI — that is prompt 02 (which owns CI integration).
- Defining additional forbidden edges — handled by prompts 06, 09, 10.
- Touching any production .go file under `cmd/` or `internal/`.
- Adding doc.go to packages — that is prompt 03.
- Any change under `internal/telemetry/`, `internal/tesla/`, `internal/signal/` (active phase-42 territory).

---

## Honesty Covenant

```
<!-- BEGIN: HONESTY_COVENANT (verbatim, do not modify) -->
1. No red-as-green     — never claim success when verification fails.
2. No scope narrowing  — implement every section in "Files touched".
3. No skip-and-assume  — run every verification step; paste actual output.
4. No field resurrection — do not re-introduce removed fields.
5. No stubs            — no TODO, no panic("not implemented"), no empty handlers.
6. No delegation       — execute the prompt yourself; do not spawn sub-agents to bypass review.
7. No predecessor bypass — depends on nothing; if anything else exists, audit it.
8. No commit on red    — Gate must be GREEN before commit/push.
9. No silent drift     — any change to forbidden_edges or layer values requires updating prompt 02.
10. Log MUST contain EXIT + STATUS lines.
<!-- END: HONESTY_COVENANT -->
```

## Artifact Metadata

| Field | Value |
|-------|-------|
| Phase | 47 |
| Prompt | 01 |
| Slug | baseline-metrics |
| Branch | `phase-47-prompt-01-baseline-metrics` |
| Log | `.github/prompts/db-refactor/logs/phase-47-01-baseline-metrics.log` |
| Risk | LOW (pure additive; no production code touched) |
| Backend touched | NO |
| Frontend touched | NO |
| Migration | NO |
| Env var added | NO |

## Logging Requirements

Every gate section must `Tee-Object -FilePath $log -Append`. Final log
MUST end with two lines:

```
EXIT=<int>
STATUS=<DONE|BLOCKED>
```

If any verification step fails, write `STATUS=BLOCKED` and `exit $exit`.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-47-01-baseline-metrics.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== PHASE-47 / 01 baseline-metrics — $(Get-Date -Format o) ===" | Tee-Object -FilePath $log

"=== STEP 1: TOOL_BUILDS ===" | Tee-Object -FilePath $log -Append
go build ./tools/archmetrics 2>&1 | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  "EXIT=$exit" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit $exit
}

"=== STEP 2: BASELINE_JSON ===" | Tee-Object -FilePath $log -Append
go run ./tools/archmetrics > tools/archmetrics/baseline.json 2>&1
$exit = $LASTEXITCODE
"baseline.json size: $((Get-Item tools/archmetrics/baseline.json).Length) bytes" | Tee-Object -FilePath $log -Append
if ($exit -ne 0) {
  "EXIT=$exit" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit $exit
}

"=== STEP 3: BASELINE_MD ===" | Tee-Object -FilePath $log -Append
go run ./tools/archmetrics -report > tools/archmetrics/baseline.md 2>&1
$exit = $LASTEXITCODE
"baseline.md size: $((Get-Item tools/archmetrics/baseline.md).Length) bytes" | Tee-Object -FilePath $log -Append
if ($exit -ne 0) {
  "EXIT=$exit" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit $exit
}

"=== STEP 4: SELF_COMPARE_OK ===" | Tee-Object -FilePath $log -Append
go run ./tools/archmetrics -compare tools/archmetrics/baseline.json 2>&1 | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  "EXIT=$exit" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit $exit
}

"=== STEP 5: REGRESSION_DETECTION ===" | Tee-Object -FilePath $log -Append
"// regression-test sentinel" | Out-File -Encoding UTF8 internal/api/zzz_phase47_test.go
go run ./tools/archmetrics -compare tools/archmetrics/baseline.json 2>&1 | Tee-Object -FilePath $log -Append
$detected = $LASTEXITCODE
Remove-Item internal/api/zzz_phase47_test.go -Force
if ($detected -eq 0) {
  "FAIL: regression NOT detected" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}
"OK: regression detected" | Tee-Object -FilePath $log -Append

"=== STEP 6: GIT_STATUS ===" | Tee-Object -FilePath $log -Append
$status = git status --porcelain
$status | Tee-Object -FilePath $log -Append
$allowed = '^\s*[AM\?]+\s+(tools/archmetrics/.*|Makefile|\.github/prompts/db-refactor/logs/phase-47-01.*)$'
$violations = $status | Where-Object { $_ -and ($_ -notmatch $allowed) }
if ($violations) {
  "FAIL: unexpected files in git status" | Tee-Object -FilePath $log -Append
  $violations | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
```

## Commit

```
chore(arch): add architecture-metrics baseline snapshotter (phase-47/01)

Adds tools/archmetrics — a standalone Go tool that snapshots package-level
file counts, LOC, import edges, and doc.go adoption into a JSON baseline +
Markdown report. Adds Makefile targets `arch-baseline` and `arch-check`.

The baseline (tools/archmetrics/baseline.json, baseline.md) is committed
so subsequent phase-47 prompts (04 main.go slim, 05 worker decouple, 06
api freeze) can prove deltas. arch_test.go (prompt 02) consumes the
baseline to enforce no-regression.

Pure additive: zero changes to cmd/* or internal/* production code.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
