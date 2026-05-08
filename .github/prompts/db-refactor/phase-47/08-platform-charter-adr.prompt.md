# Phase-47 / Prompt 08 — ADR-007: internal/platform/* charter

## Why

`internal/platform/` is currently a **partial junk drawer** with six
subpackages of mixed concerns:

```
internal/platform/buildinfo/    (build metadata; canonical home — NO duplicate at internal/buildinfo)
internal/platform/cache/        (cache abstractions — but internal/cache also exists)
internal/platform/config/       (config helpers — but internal/config is the canonical config)
internal/platform/database/     (DB helpers — but internal/database AND internal/adapter/postgres exist)
internal/platform/httputil/     (HTTP client + APICallSink interface)
internal/platform/telemetry/    (OpenTelemetry plumbing — at risk of name confusion with phase-42 telemetry)
```

Without a charter, every cross-cutting helper ends up here, and the
duplication with `internal/cache`, `internal/config`, `internal/database`
deepens. The PA critique called this out as the third concrete
remediation item.

This prompt records **ADR-007** establishing what `internal/platform/`
SHOULD contain (cross-cutting infrastructure that does NOT belong to a
specific bounded context, port, or adapter), what each existing subpackage
should contain, and which existing subpackages should MOVE to a more
specific layer in a later phase. arch_test gains a "no new platform
subpackages without ADR amendment" guard.

This prompt **does not move any code**. Moves are tracked separately
because each requires per-package risk assessment.

## Evidence

```powershell
PS> Get-ChildItem internal/platform -Directory | Select-Object Name, @{n="Files";e={(Get-ChildItem $_.FullName -Filter *.go).Count}}
Name       Files
----       -----
buildinfo      ?
cache          ?
config         ?
database       ?
httputil       ?
telemetry      ?

PS> Test-Path internal/cache
True
PS> Test-Path internal/config
True
PS> Test-Path internal/database
True
PS> Test-Path internal/adapter/postgres
True
PS> Test-Path internal/telemetry
True   (phase-42 territory — being deleted)
```

So we already have:
- `internal/cache` AND `internal/platform/cache` — duplicate concern.
- `internal/config` AND `internal/platform/config` — duplicate.
- `internal/database` AND `internal/platform/database` AND `internal/adapter/postgres` — triplicate.
- `internal/telemetry` (phase-42 deletes) AND `internal/platform/telemetry` (OpenTelemetry — name collision risk).

## Design

### Step 1 — Append ADR-007 to `.github/ARCHITECTURE.md`

```markdown
## ADR-007: internal/platform/ Charter

```
STATUS: APPROVED (PA, phase-47/08)
DATE: <YYYY-MM-DD set on execution>
SUPERSEDES: implicit "platform = anywhere shared"

DECISION:

  internal/platform/ contains CROSS-CUTTING INFRASTRUCTURE that:
    - Is not specific to a bounded context (otherwise it belongs in
      internal/domain/<X> or internal/app/<X>svc).
    - Is not a port interface (otherwise internal/port/...).
    - Is not an adapter to an external system (otherwise
      internal/adapter/<name>).
    - Does not host HTTP request handlers (otherwise
      internal/handler/v1).

  Examples of LEGITIMATE platform/ residents:
    - HTTP client construction with shared timeouts and middleware
    - Generic pagination/cursor helpers
    - Reusable middleware (request ID, panic recovery)
    - Build-time metadata
    - OpenTelemetry plumbing (renamed to platform/observability — see EXISTING SUBPACKAGES)

EXISTING SUBPACKAGES (charter status):

  platform/buildinfo  → DEPRECATED in this directory; canonical home is
                        internal/buildinfo (created by phase-47/04). Move
                        any remaining content to internal/buildinfo.
  platform/cache      → DEPRECATED. Canonical home is internal/cache.
                        Audit duplication; consolidate in phase-48.
  platform/config     → DEPRECATED. Canonical home is internal/config.
                        Audit duplication; consolidate in phase-48.
  platform/database   → DEPRECATED. Canonical home depends on type:
                        - generic SQL helpers → internal/adapter/postgres
                        - higher-level repo wrappers → internal/database
                        Audit; consolidate in phase-48.
  platform/httputil   → KEEP. Charter: shared HTTP client construction
                        with circuit-breaking, timeouts, and the
                        APICallSink interface consumed by internal/apilog.
  platform/telemetry  → RENAME to platform/observability in phase-48 to
                        avoid collision with internal/telemetry (phase-42).
                        Charter: OpenTelemetry tracing/metrics plumbing.

NEW PLATFORM SUBPACKAGES require an ADR amendment + reviewer sign-off.
arch_test fails on unrecognised platform/<name> directories.

RATIONALE:
  - Today's organic growth produced four duplicates with no source-of-
    truth designation.
  - Charter clarifies WHEN platform/ is the right answer (cross-cutting +
    no specific layer fits) vs WHEN to use a specific layer.
  - Deprecation of duplicates is recorded; consolidation tracked under
    phase-48.

ROLLBACK:
  - If a deprecation creates an unsolvable circular dep, propose
    superseding ADR with rationale. Do not silently restore.
```
```

### Step 2 — Update each platform subpackage's `doc.go`

For `internal/platform/buildinfo/doc.go`, `internal/platform/cache/doc.go`,
`internal/platform/config/doc.go`, `internal/platform/database/doc.go`:
ADD a deprecation notice. The package keeps existing functionality —
the notice steers NEW additions elsewhere:

```go
// Package <name> ...existing prose...
//
// Layer: platform
//
// DEPRECATED per ADR-007: new code belongs in internal/<canonical-home>.
// Existing symbols here remain functional; consolidation tracked in phase-48.
package <name>
```

For `internal/platform/httputil/doc.go`: KEEP notice, no deprecation:

```go
// Package httputil provides shared HTTP client construction with
// circuit breakers, request/response logging hooks (APICallSink), and
// uniform timeouts.
//
// Layer: platform
//
// CANONICAL per ADR-007 — this is the right home for cross-cutting
// HTTP client utilities.
package httputil
```

For `internal/platform/telemetry/doc.go`: KEEP with rename notice:

```go
// Package telemetry hosts OpenTelemetry tracing and metrics plumbing
// shared across binaries.
//
// Layer: platform
//
// Per ADR-007: this package will be RENAMED to internal/platform/observability
// in phase-48 to avoid name collision with internal/telemetry (phase-42).
package telemetry
```

### Step 3 — arch_test allow-list of platform subpackages

In `internal/arch/rules.go`:

```go
// AllowedPlatformSubpackages is the closed set of permitted directories
// directly under internal/platform/. Adding a new one requires an
// ADR-007 amendment AND updating this list in the same commit.
var AllowedPlatformSubpackages = []string{
	"buildinfo",
	"cache",
	"config",
	"database",
	"httputil",
	"telemetry",
}
```

In `internal/arch/arch_test.go`:

```go
func TestPlatformSubpackagesGated(t *testing.T) {
	root := filepath.Join("..", "..", "internal", "platform")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	allowed := map[string]bool{}
	for _, n := range AllowedPlatformSubpackages {
		allowed[n] = true
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if !allowed[e.Name()] {
			t.Errorf("unauthorised internal/platform/%s — add to AllowedPlatformSubpackages with an ADR-007 amendment, or move to a specific layer", e.Name())
		}
	}
}
```

### Step 4 — Architecture index entry

If `.github/ARCHITECTURE.md` has a TOC at the top, add `ADR-007` entry.
If not, ensure the headers are at least nav-friendly (sequential).

### Step 5 — Optional: consolidation issue list

Create `docs/architecture/platform-consolidation-todo.md` listing the
moves that phase-48 will execute. This is a tracking document, not a plan:

```markdown
# Platform consolidation TODO (phase-48 candidates)

Per ADR-007, the following moves are deferred:

- [ ] internal/platform/buildinfo → internal/buildinfo
      Risk: low. Affects: cmd/teslasync linker flags, ~3 import sites.

- [ ] internal/platform/cache → internal/cache
      Risk: medium. Affects: ~8 import sites; check for collision with
      internal/cache type names.

- [ ] internal/platform/config → internal/config
      Risk: medium. Affects: ~5 import sites.

- [ ] internal/platform/database → internal/database OR internal/adapter/postgres
      Risk: high. Affects: ~12 import sites; needs per-symbol decision.

- [ ] internal/platform/telemetry → internal/platform/observability
      Risk: low (rename only). Affects: ~6 import sites.

These are NOT phase-47 work. Each becomes a phase-48 prompt.
```

## Verification

```
1. ARCHITECTURE.md must contain "## ADR-007:" — grep verifies.
2. Each existing platform/<name>/doc.go references ADR-007:
     foreach ($n in "buildinfo","cache","config","database","httputil","telemetry") {
       Select-String -Path "internal/platform/$n/doc.go" -Pattern "ADR-007"
     }
   → all 6 must produce a hit.
3. go test -v ./internal/arch/... — TestPlatformSubpackagesGated must PASS.
4. Negative test:
     New-Item -ItemType Directory internal/platform/zzz_phase47
     New-Item -ItemType File internal/platform/zzz_phase47/x.go
     "package zzz_phase47" | Out-File internal/platform/zzz_phase47/x.go
     go test -run TestPlatformSubpackagesGated ./internal/arch/...
   → MUST FAIL citing "unauthorised internal/platform/zzz_phase47".
   Remove-Item -Recurse internal/platform/zzz_phase47.
5. Refresh baseline.
```

## Files touched

```
ADDED:
  docs/architecture/platform-consolidation-todo.md

MODIFIED:
  .github/ARCHITECTURE.md                    (+ ADR-007 section)
  internal/platform/buildinfo/doc.go         (+ DEPRECATED notice; create if missing)
  internal/platform/cache/doc.go             (+ DEPRECATED; create if missing)
  internal/platform/config/doc.go            (+ DEPRECATED; create if missing)
  internal/platform/database/doc.go          (+ DEPRECATED; create if missing)
  internal/platform/httputil/doc.go          (CANONICAL notice)
  internal/platform/telemetry/doc.go         (+ RENAME notice; create if missing)
  internal/arch/rules.go                     (+ AllowedPlatformSubpackages)
  internal/arch/arch_test.go                 (+ TestPlatformSubpackagesGated)
  tools/archmetrics/baseline.json            (refresh)
  tools/archmetrics/baseline.md              (refresh)

DELETED:
  (none — no code moves in this prompt)
```

## Out of scope

- **Moving any code from internal/platform/* to its canonical home** —
  tracked under phase-48 per ADR-007.
- Renaming `internal/platform/telemetry` to `observability` — phase-48.
- Touching `internal/cache`, `internal/config`, `internal/database` directly.
- Defining what `internal/normalize/`, `internal/router/`, `internal/codec/`, `internal/units/`, `internal/bootstrap/` belong to (phase-42 owns those).
- Anything under `internal/telemetry/`, `internal/tesla/`, `internal/signal/` (active phase-42).

---

## Honesty Covenant

```
<!-- BEGIN: HONESTY_COVENANT (verbatim, do not modify) -->
1. No red-as-green     — TestPlatformSubpackagesGated passes; negative test fails.
2. No scope narrowing  — every existing platform/<name>/doc.go updated.
3. No skip-and-assume  — paste output of negative test.
4. No field resurrection — N/A.
5. No stubs            — ADR-007 prose is the full content above.
6. No delegation       — execute yourself.
7. No predecessor bypass — depends on prompts 01, 02, 03.
8. No commit on red    — Gate must be GREEN.
9. No silent drift     — adding a NEW platform subpackage requires ADR amendment + AllowedPlatformSubpackages update IN THE SAME COMMIT.
10. Log MUST contain EXIT + STATUS lines.
<!-- END: HONESTY_COVENANT -->
```

## Artifact Metadata

| Field | Value |
|-------|-------|
| Phase | 47 |
| Prompt | 08 |
| Slug | platform-charter-adr |
| Branch | `phase-47-prompt-08-platform-charter-adr` |
| Log | `.github/prompts/db-refactor/logs/phase-47-08-platform-charter-adr.log` |
| Risk | LOW (declarative + arch_test guard) |
| Backend touched | NO (doc + tooling) |
| Frontend touched | NO |
| Migration | NO |
| Env var added | NO |
| Depends on | prompts 01, 02, 03 |

## Logging Requirements

Every gate section uses `Tee-Object -FilePath $log -Append`. Final log
ends with `EXIT=<int>` + `STATUS=<DONE|BLOCKED>`.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-47-08-platform-charter-adr.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== PHASE-47 / 08 platform-charter-adr — $(Get-Date -Format o) ===" | Tee-Object -FilePath $log

"=== STEP 1: ADR_007 ===" | Tee-Object -FilePath $log -Append
$adr = Select-String -Path .github/ARCHITECTURE.md -Pattern "^## ADR-007:"
if ($adr.Count -lt 1) {
  "FAIL: ADR-007 missing" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 2: PLATFORM_DOC_GO_REFS ===" | Tee-Object -FilePath $log -Append
$subs = "buildinfo","cache","config","database","httputil","telemetry"
$missing = @()
foreach ($n in $subs) {
  $hit = Select-String -Path "internal/platform/$n/doc.go" -Pattern "ADR-007" -ErrorAction SilentlyContinue
  if (-not $hit) { $missing += $n }
}
if ($missing.Count -gt 0) {
  "FAIL: platform subpackages missing ADR-007 reference: $($missing -join ',')" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 3: ARCH_TEST ===" | Tee-Object -FilePath $log -Append
go test -v ./internal/arch/... 2>&1 | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) { "EXIT=$exit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $exit }

"=== STEP 4: NEGATIVE_TEST ===" | Tee-Object -FilePath $log -Append
New-Item -ItemType Directory -Force internal/platform/zzz_phase47 | Out-Null
"package zzz_phase47" | Out-File -Encoding UTF8 internal/platform/zzz_phase47/x.go
$out = go test -run TestPlatformSubpackagesGated ./internal/arch/... 2>&1
$out | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
Remove-Item -Recurse internal/platform/zzz_phase47 -Force
if ($exit -eq 0) {
  "FAIL: TestPlatformSubpackagesGated did not detect zzz_phase47" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 5: REFRESH_BASELINE ===" | Tee-Object -FilePath $log -Append
go run ./tools/archmetrics > tools/archmetrics/baseline.json 2>&1
go run ./tools/archmetrics -report > tools/archmetrics/baseline.md 2>&1

"=== STEP 6: GIT_STATUS ===" | Tee-Object -FilePath $log -Append
$status = git status --porcelain
$status | Tee-Object -FilePath $log -Append
$allowed = '^\s*[AM\?]+\s+(\.github/ARCHITECTURE\.md|internal/platform/(buildinfo|cache|config|database|httputil|telemetry)/doc\.go|internal/arch/(rules|arch_test)\.go|docs/architecture/platform-consolidation-todo\.md|tools/archmetrics/baseline\.(json|md)|\.github/prompts/db-refactor/(logs/phase-47-08.*|phase-47/08-platform-charter-adr\.prompt\.md))$'
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
docs(arch): ADR-007 — internal/platform/ charter + subpackage gating (phase-47/08)

Records the rule: internal/platform/ is for cross-cutting infrastructure
that does not belong to a specific bounded context, port, or adapter.
Existing subpackages classified:

  buildinfo / cache / config / database  → DEPRECATED here; canonical
                                            home is internal/<name>;
                                            consolidation tracked under
                                            phase-48.
  httputil                               → CANONICAL — keep.
  telemetry                              → KEEP, RENAME to observability
                                            in phase-48 (avoid collision
                                            with internal/telemetry).

Adds AllowedPlatformSubpackages list in internal/arch/rules.go and
TestPlatformSubpackagesGated — fails the build if a new directory
appears under internal/platform/ without an ADR amendment.

Adds docs/architecture/platform-consolidation-todo.md tracking the
deferred moves.

This prompt records direction; does NOT move any code.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
