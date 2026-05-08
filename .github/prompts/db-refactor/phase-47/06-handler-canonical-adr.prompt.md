# Phase-47 / Prompt 06 — ADR-009: handler/v1 canonical, internal/api FROZEN

## Why

`internal/api/` (223 .go files) and `internal/handler/v1/` (7 handlers) are
two competing HTTP handler trees. The newer `handler/v1` aligns with the
hexagonal scaffolding (`internal/app/<bounded>svc`, `internal/domain/...`,
`internal/port/...`, `internal/adapter/...`) but covers ≈ 3 % of the API
surface. The older `internal/api/` is procedural and grew organically.

Without an explicit charter, future contributors flip a coin and the
divide widens. Today's PA critique listed this as the most expensive open
question in the codebase: every new endpoint lands in the wrong place, and
every refactor faces "well, where SHOULD this go?"

This prompt **does not migrate any existing handler**. It records the
decision in `ARCHITECTURE.md` as **ADR-009**, freezes
`internal/api/` against new files (enforced by arch_test), and adds a
deprecation notice in `internal/api/doc.go`. The actual port of 200+ files
from `internal/api/` to `internal/handler/v1/` is a long-tail effort
spanning phase-48+ and will be its own multi-prompt phase.

## Evidence

```powershell
PS> Get-ChildItem -Recurse internal/api -Filter *.go | Measure-Object
Count: 223

PS> Get-ChildItem -Recurse internal/handler/v1 -Filter *.go | Measure-Object
Count: 7

PS> Get-ChildItem internal/handler -Directory | Select-Object -ExpandProperty Name
dto
middleware
v1

PS> Get-ChildItem internal/app -Directory | Select-Object -ExpandProperty Name
chargingsvc
dashboardsvc
exportsvc
notificationsvc
tripsvc
vehiclesvc
```

The hexagonal scaffolding around `handler/v1` exists and is correctly
shaped. There is no `handler/v2` planned. The decision is binary:
freeze `api/` and grow `handler/v1`, OR embrace `api/` and delete
`handler/v1`. Phase-47 records the former.

## Design

### Step 1 — Append ADR-009 to `.github/ARCHITECTURE.md`

Insert after the last existing ADR. Numbering: phase-42 introduces
ADR-004; this is ADR-009.

```markdown
## ADR-009: HTTP Handler Canonical Home

```
STATUS: APPROVED (PA, phase-47/06)
DATE: <YYYY-MM-DD set on execution>
SUPERSEDES: implicit "use whichever package you find first"
NUMBERING NOTE: this prompt was authored expecting ADR-009 but ADR-009
(Frontend SI Cutover, phase-43) and ADR-008 (Observability stack,
phase-44) were already taken when the prompt executed. Renumbered to
ADR-009 in the same commit.

DECISION:
  internal/handler/v1 is the CANONICAL home for new HTTP handlers.
  internal/api is FROZEN: no new .go files may be added.

RULES:
  ✅ ADD new handlers under internal/handler/v1/<name>_handler.go.
  ✅ EDITS to existing internal/api/*.go files are permitted (bug fixes,
     dependency updates, deprecations).
  ✅ MIGRATION of existing internal/api handlers to handler/v1 is
     encouraged but tracked separately (phase-48+).
  ✅ Handlers under handler/v1 MUST call into internal/app/<name>svc
     services. Direct repo or database access is forbidden (arch_test
     enforces — see prompt 10).
  ✅ Handler/v1 + app/<name>svc + adapter/postgres + domain/<name>
     code paths are the canonical SI-units pipeline per Phase-48 (SI
     Canonical Mega-PR). NO new field may carry imperial-unit suffixes
     (DistanceMiles, EnergyUsedKWh, MaxSpeedMph, EfficiencyWhMi,
     TotalMiles, MilesAdded, ChargerPowerKw*). All persisted/transported
     numeric fields are SI: meters, m/s, °C, Pa, Wh.
     See: .github/prompts/db-refactor/phase-48-si-canonical/0000-methodology.prompt.md

  ❌ No new .go file may be created under internal/api (arch_test FAILS).
  ❌ EXCEPTION: `_test.go` files for existing `internal/api/*.go` source
     files ARE permitted, because tests must live in the same Go package
     as the code under test. arch_test MUST distinguish `_test.go` from
     production source. Phase-44 prompts 0011 + 0020 rely on this
     exception.
  ❌ No new sub-directory may be created under internal/api.
  ❌ Do not add new package-level vars to internal/api outside aliases
     created by phase-47/05 deprecation.
  ❌ No new imperial-unit field names anywhere in handler/v1, dto,
     app/*svc, domain/*, or adapter/postgres (Phase-48 SI canonical
     mandate). Display conversion is React-only via useUnits/useFormatting.

RATIONALE:
  - Hexagonal scaffolding (domain, port, adapter, app, handler) is
    already in place and partially populated.
  - internal/api grew procedurally to 223 files with mixed concerns;
    further additions deepen the technical debt.
  - handler/v1 + app/<name>svc give us testable, layer-respecting code.

ROLLBACK:
  If handler/v1 + app proves insufficient (e.g. perf regressions on a
  hot endpoint), record an exception under "ADR-009 Exceptions" in this
  file with rationale and an issue link. Do not silently bypass the
  freeze.
```
```

### Step 2 — Update `internal/api/doc.go`

Append a clear deprecation notice:

```go
// Package api hosts TeslaSync's legacy HTTP handlers under /api/v1/*.
//
// Layer: handler
//
// FROZEN per ADR-009 (.github/ARCHITECTURE.md, phase-47/06):
//   - No new .go files may be added to this directory.
//   - Existing files may be edited (bug fixes, dependency updates).
//   - New endpoints belong in internal/handler/v1.
//
// Migration of these 223 files to internal/handler/v1 is tracked under
// phase-48+ and is explicitly out of scope of phase-47.
package api
```

### Step 3 — Update `internal/handler/v1/doc.go`

Mark it canonical:

```go
// Package v1 contains the canonical HTTP handlers for TeslaSync's
// REST API under /api/v1.
//
// Layer: handler
//
// CANONICAL per ADR-009. New endpoints land here. Handlers are thin:
// they decode the request, call internal/app/<bounded-context>svc, and
// encode the response. Direct database access is forbidden — arch_test
// (phase-47/10) enforces this.
package v1
```

### Step 4 — Add arch_test rule "no new files under internal/api"

In `internal/arch/rules.go`, add:

```go
// FrozenPackages lists package paths where new .go files are not allowed.
// arch_test compares the live file list against tools/archmetrics/baseline.json
// and fails if any file appears in a frozen package that isn't in the baseline.
var FrozenPackages = []string{
	"internal/api",
}
```

In `internal/arch/arch_test.go`, add a new test function:

```go
func TestFrozenPackagesNoNewFiles(t *testing.T) {
	baseline := loadBaselineOrSkip(t, filepath.Join("..", "..", "tools", "archmetrics", "baseline.json"))
	if baseline == nil {
		t.Skip("no baseline file (phase-47/01 prerequisite)")
	}

	for _, frozen := range FrozenPackages {
		liveFiles := listGoFiles(filepath.Join("..", "..", frozen))
		baseFiles := baseline.GoFilesIn(frozen)
		newFiles := setSubtract(liveFiles, baseFiles)
		if len(newFiles) > 0 {
			t.Errorf("FROZEN PACKAGE %s has %d new file(s) not in baseline:\n  %s\n  → ADR-009 forbids new files here. Add the new endpoint to internal/handler/v1 OR refresh the baseline if this is an intentional exception.",
				frozen, len(newFiles), strings.Join(newFiles, "\n  "))
		}
	}
}
```

Helpers `listGoFiles`, `setSubtract`, and `baseline.GoFilesIn` are small
utilities — implement inline.

### Step 5 — Update `tools/archmetrics/main.go`

Extend the `Snapshot` struct with a `FilesByPackage map[string][]string`
field listing every `.go` file in each package (relative path). This lets
arch_test's `GoFilesIn(pkg)` be a simple map lookup.

```go
type Snapshot struct {
	// ... existing fields
	FilesByPackage map[string][]string `json:"files_by_package"`
}
```

Also extend `diff()` to flag any new file in a `FrozenPackages` path as a
regression. (FrozenPackages list is duplicated as a const in archmetrics
or imported from internal/arch — pick whichever the executor prefers; the
internal/arch import path is `github.com/.../internal/arch` and works
because tools/archmetrics is a main package outside cmd/.)

### Step 6 — README/runbook addition

Append to `tools/archmetrics/README.md`:

```markdown
## Frozen packages

Per ADR-009, `internal/api` is frozen against new files. To intentionally
add a file (e.g. for a critical bug fix that genuinely belongs in api/):

1. Get explicit reviewer approval citing why handler/v1 is unsuitable.
2. Add the file.
3. Run `make arch-baseline` to refresh the baseline.
4. Commit the baseline alongside the new file.
5. Reference ADR-009 Exceptions in the PR description.
```

## Verification

```
1. Append ADR-009 to ARCHITECTURE.md — confirm Markdown renders cleanly
   (preview in VS Code or any md viewer).
2. internal/api/doc.go updated — must contain the FROZEN notice.
3. internal/handler/v1/doc.go updated — must contain CANONICAL notice.
4. go test ./internal/arch/... — TestFrozenPackagesNoNewFiles PASSES
   (since no new files are present yet).
5. Negative test:
     New-Item -ItemType File internal/api/zzz_phase47_test.go
     go test -v -run TestFrozenPackagesNoNewFiles ./internal/arch/...
   → MUST fail with the ADR-009 message.
   Remove-Item internal/api/zzz_phase47_test.go
6. go test ./internal/arch/... — fully green.
7. go run ./tools/archmetrics > tools/archmetrics/baseline.json
   → confirm files_by_package map is populated.
8. Refresh baseline + report.
```

## Files touched

```
ADDED:
  (none)

MODIFIED:
  .github/ARCHITECTURE.md                    (+ ADR-009 section)
  internal/api/doc.go                        (FROZEN notice)
  internal/handler/v1/doc.go                 (CANONICAL notice)
  internal/arch/rules.go                     (+ FrozenPackages var)
  internal/arch/arch_test.go                 (+ TestFrozenPackagesNoNewFiles)
  tools/archmetrics/main.go                  (+ FilesByPackage; diff regression)
  tools/archmetrics/README.md                (+ Frozen packages section)
  tools/archmetrics/baseline.json            (refresh)
  tools/archmetrics/baseline.md              (refresh)

DELETED:
  (none)
```

## Out of scope

- **Migrating any handler from internal/api to internal/handler/v1** —
  that is phase-48+. This prompt only declares the rule.
- Adding `handler/v2` — no.
- Touching internal/api/* business logic.
- Defining endpoint-discovery tooling — separate concern.
- Anything under `internal/telemetry/`, `internal/tesla/`,
  `internal/signal/` (active phase-42 territory; phase-42 may add files
  to internal/api as part of its consumer migration — prompt 06 must
  ship AFTER phase-42 9999-final-gate).

---

## Honesty Covenant

```
<!-- BEGIN: HONESTY_COVENANT (verbatim, do not modify) -->
1. No red-as-green     — TestFrozenPackagesNoNewFiles must pass; negative test must fail as described.
2. No scope narrowing  — both doc.go files updated AND ARCHITECTURE.md ADR section added AND archmetrics extended.
3. No skip-and-assume  — paste output of negative test (must show ADR-009 error message).
4. No field resurrection — N/A.
5. No stubs            — ADR-009 prose must be the full content shown above, not a placeholder.
6. No delegation       — execute yourself.
7. No predecessor bypass — depends on prompts 01, 02, 03; MUST ship AFTER phase-42 9999-final-gate.
8. No commit on red    — Gate must be GREEN.
9. No silent drift     — if you add a package to FrozenPackages beyond internal/api, document it in this prompt's commit body.
10. Log MUST contain EXIT + STATUS lines.
<!-- END: HONESTY_COVENANT -->
```

## Artifact Metadata

| Field | Value |
|-------|-------|
| Phase | 47 |
| Prompt | 06 |
| Slug | handler-canonical-adr |
| Branch | `phase-47-prompt-06-handler-canonical-adr` |
| Log | `.github/prompts/db-refactor/logs/phase-47-06-handler-canonical-adr.log` |
| Risk | LOW (declarative + new arch_test rule) |
| Backend touched | NO (only doc + tooling) |
| Frontend touched | NO |
| Migration | NO |
| Env var added | NO |
| Depends on | prompts 01, 02, 03; HARD-after phase-42 final gate |

## Logging Requirements

Every gate section uses `Tee-Object -FilePath $log -Append`. Final log
ends with `EXIT=<int>` + `STATUS=<DONE|BLOCKED>`.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-47-06-handler-canonical-adr.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== PHASE-47 / 06 handler-canonical-adr — $(Get-Date -Format o) ===" | Tee-Object -FilePath $log

"=== STEP 1: ADR_009_PRESENT ===" | Tee-Object -FilePath $log -Append
$adr = Select-String -Path .github/ARCHITECTURE.md -Pattern "## ADR-009:" -SimpleMatch
"ADR-009 lines: $($adr.Count)" | Tee-Object -FilePath $log -Append
if ($adr.Count -lt 1) {
  "FAIL: ADR-009 not added to ARCHITECTURE.md" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 2: FROZEN_NOTICE_API ===" | Tee-Object -FilePath $log -Append
$frozen = Select-String -Path internal/api/doc.go -Pattern "FROZEN per ADR-009"
if ($frozen.Count -lt 1) {
  "FAIL: internal/api/doc.go missing FROZEN notice" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}
$canonical = Select-String -Path internal/handler/v1/doc.go -Pattern "CANONICAL per ADR-009"
if ($canonical.Count -lt 1) {
  "FAIL: internal/handler/v1/doc.go missing CANONICAL notice" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 3: ARCH_TEST ===" | Tee-Object -FilePath $log -Append
go test -v ./internal/arch/... 2>&1 | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) { "EXIT=$exit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $exit }

"=== STEP 4: NEGATIVE_TEST ===" | Tee-Object -FilePath $log -Append
"package api" | Out-File -Encoding UTF8 internal/api/zzz_phase47_sentinel.go
$negOut = go test -run TestFrozenPackagesNoNewFiles ./internal/arch/... 2>&1
$negOut | Tee-Object -FilePath $log -Append
$detected = $LASTEXITCODE
Remove-Item internal/api/zzz_phase47_sentinel.go -Force
if ($detected -eq 0) {
  "FAIL: negative test did not detect new file in internal/api" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}
if (-not (($negOut | Out-String) -match "ADR-009")) {
  "FAIL: failure message did not cite ADR-009" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 5: REFRESH_BASELINE ===" | Tee-Object -FilePath $log -Append
go run ./tools/archmetrics > tools/archmetrics/baseline.json 2>&1
go run ./tools/archmetrics -report > tools/archmetrics/baseline.md 2>&1
$bl = Get-Content tools/archmetrics/baseline.json | ConvertFrom-Json
$apiFiles = $bl.files_by_package.'internal/api'.Count
"baseline files in internal/api = $apiFiles" | Tee-Object -FilePath $log -Append
if ($apiFiles -lt 100) {
  "FAIL: files_by_package map appears uninitialised" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 6: GIT_STATUS ===" | Tee-Object -FilePath $log -Append
$status = git status --porcelain
$status | Tee-Object -FilePath $log -Append
$allowed = '^\s*[AM\?]+\s+(\.github/ARCHITECTURE\.md|internal/(api|handler/v1)/doc\.go|internal/arch/(rules|arch_test)\.go|tools/archmetrics/(main\.go|README\.md|baseline\.(json|md))|\.github/prompts/db-refactor/(logs/phase-47-06.*|phase-47/06-handler-canonical-adr\.prompt\.md))$'
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
docs(arch): ADR-009 — handler/v1 canonical, internal/api FROZEN (phase-47/06)

Records the binary decision: new HTTP handlers belong in
internal/handler/v1, not internal/api. internal/api is FROZEN against new
files (existing files may still be edited).

Adds:
  - ADR-009 section in .github/ARCHITECTURE.md
  - FROZEN notice in internal/api/doc.go
  - CANONICAL notice in internal/handler/v1/doc.go
  - FrozenPackages list in internal/arch/rules.go
  - TestFrozenPackagesNoNewFiles in internal/arch/arch_test.go
  - files_by_package map in tools/archmetrics snapshot

Migration of 223 files from internal/api → internal/handler/v1 is
explicitly out of scope (tracked under phase-48+).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
