# Phase-47 / Prompt 10 — Handler thinness rule

## Why

ADR-005 (prompt 06) declared `internal/handler/v1` canonical. ADR-006
(prompt 07) declared the models/domain charter. ADR-007 (prompt 08)
charted `internal/platform/`. Prompt 09 enforced the
port/adapter/domain layering. The remaining hexagonal contract:

> A handler is **thin**. It decodes the request, calls a use-case in
> `internal/app/<bounded-context>svc`, encodes the response. It does
> NOT touch the database, ORM, or external adapters directly.

Today this is unwritten convention. As `internal/handler/v1` grows from
7 to (eventually) 200+ files, drift is inevitable without a hard rule.

This prompt installs the **handler thinness rule** as a fail-level
arch_test:

- Files under `internal/handler/v1/` may import:
  - stdlib
  - `internal/app/...` (canonical use-case home)
  - `internal/domain/...` (entity types in handler signatures)
  - `internal/handler/dto`
  - `internal/handler/middleware`
  - `internal/port/...` (interface types)
  - `internal/handler/v1` itself (sibling files)
  - 3rd-party HTTP framework imports (`go-chi`, etc.)
- Files under `internal/handler/v1/` may NOT import:
  - `internal/database` (handlers must not query directly)
  - `internal/adapter/...` (handlers must not poke adapters)
  - `internal/models` (handlers use DTOs from `internal/handler/dto`)
  - `internal/api` (FROZEN; siblings depend on it via app.run.go alias only)
  - `internal/platform/database` (same as internal/database)

`internal/api/` is **explicitly exempted** — it is FROZEN per ADR-005,
its 223 files freely query the database and that's intentional until each
handler migrates to `handler/v1`.

## Evidence

```powershell
PS> Get-ChildItem internal/handler/v1 -Filter *.go | Select-Object Name
charging_handler.go
dashboard_handler.go
export_handler.go
helpers.go
trip_handler.go
user_handler.go
vehicle_handler.go

PS> foreach ($f in Get-ChildItem internal/handler/v1 -Filter *.go) {
      Select-String -Path $f -Pattern "internal/(database|models|adapter)"
    }
   (executor will report any violations; expect 0 or very few)
```

The 7 handlers were authored under hexagonal discipline already, so this
rule should pass clean today. The rule's value is **forward** — preventing
regression as 200+ more handlers migrate from `internal/api/`.

## Design

### Step 1 — Append rules in `internal/arch/rules.go`

```go
var ForbiddenEdges = append(ForbiddenEdges, []ForbiddenEdge{
	{Source: "internal/handler/v1",       Target: "internal/database",       Reason: "handlers must call internal/app/<name>svc, not the database directly"},
	{Source: "internal/handler/v1",       Target: "internal/platform/database", Reason: "handlers must call internal/app/<name>svc, not platform DB helpers"},
	{Source: "internal/handler/v1",       Target: "internal/adapter/...",    Reason: "handlers must depend on ports, not adapter implementations"},
	{Source: "internal/handler/v1",       Target: "internal/models",         Reason: "handlers use internal/handler/dto for transport DTOs (ADR-006)"},
	{Source: "internal/handler/v1",       Target: "internal/api",            Reason: "internal/api is FROZEN per ADR-005; handlers must not import it"},
}...)

// Promote: remove from AdvisorySources if present.
// (Already covered by phase-47/02's seed which had handler/v1→database advisory;
//  this prompt removes the entry.)
```

### Step 2 — Update arch_test for the new fail-level rules

`TestForbiddenEdges` already iterates `ForbiddenEdges`; no code change
needed beyond the rules.go edit. Add a focused test for clarity:

```go
func TestHandlerV1Thinness(t *testing.T) {
	cfg := &packages.Config{Mode: packages.NeedName | packages.NeedImports, Dir: "../.."}
	pkgs, err := packages.Load(cfg, "./internal/handler/v1/...")
	if err != nil {
		t.Fatalf("packages.Load: %v", err)
	}
	forbidden := []string{
		"internal/database",
		"internal/platform/database",
		"internal/models",
		"internal/api",
	}
	forbiddenPrefix := []string{
		"internal/adapter/",
	}
	for _, p := range pkgs {
		for tgt := range p.Imports {
			t := strings.TrimPrefix(tgt, modulePath+"/")
			for _, f := range forbidden {
				if t == f && !isException(p.PkgPath, t) {
					tt.Errorf("handler thinness: %s imports %s — call internal/app/<name>svc instead", p.PkgPath, t)
				}
			}
			for _, prefix := range forbiddenPrefix {
				if strings.HasPrefix(t, prefix) && !isException(p.PkgPath, t) {
					tt.Errorf("handler thinness: %s imports adapter %s — depend on internal/port/* interfaces instead", p.PkgPath, t)
				}
			}
		}
	}
}
```

### Step 3 — Update `internal/handler/v1/doc.go`

Strengthen the contract statement (originally added in prompt 06):

```go
// Package v1 contains the canonical HTTP handlers for TeslaSync's REST
// API under /api/v1.
//
// Layer: handler
//
// CANONICAL per ADR-005. Handlers are THIN per the rule installed in
// phase-47/10:
//
//   - May import: internal/app/<name>svc, internal/handler/dto,
//     internal/handler/middleware, internal/port/*, internal/domain/*,
//     stdlib, go-chi, encoding/json.
//   - May NOT import: internal/database, internal/adapter/*,
//     internal/models, internal/api, internal/platform/database.
//
// arch_test (internal/arch) enforces.
package v1
```

### Step 4 — Add a worked-example test under `internal/handler/v1/`

To make the contract concrete for future contributors, add a test file
demonstrating the canonical handler shape:

```go
// internal/handler/v1/example_thin_handler_test.go
package v1_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/app/vehiclesvc"
	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
)

// TestExampleThinHandler shows the canonical handler shape. New v1
// handlers SHOULD follow this pattern.
func TestExampleThinHandler(t *testing.T) {
	// 1. Construct a fake use-case (interface, not concrete repo).
	svc := &fakeVehicleService{
		fn: func(ctx context.Context, id int64) (vehicle.Vehicle, error) {
			return vehicle.New(id, "Model 3"), nil
		},
	}

	// 2. Wrap it in the handler.
	h := newGetVehicleHandler(svc)

	// 3. Drive it with httptest.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/vehicles/42", nil)
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rec.Code)
	}
	var got map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&got)
	if got["display_name"] != "Model 3" {
		t.Errorf("body: %+v", got)
	}
}

type fakeVehicleService struct {
	fn func(context.Context, int64) (vehicle.Vehicle, error)
}

func (f *fakeVehicleService) Get(ctx context.Context, id int64) (vehicle.Vehicle, error) {
	return f.fn(ctx, id)
}

var _ vehiclesvc.GetVehiclePort = (*fakeVehicleService)(nil) // compile-time port check
```

This test compiles even if the executor decides not to add a real
`newGetVehicleHandler` — IF that function doesn't exist yet, mark the
test file `//go:build phase47_example` to keep it dormant. (The point is
documentation, not runtime coverage.)

### Step 5 — Refresh exemptions doc

`internal/arch/regenerate_exceptions.go` was intentionally NOT created in
phase-47/09 (zero exemptions on the live tree). For prompt 10 we
manually verify whether the new fail-level rules surface any new
forbidden edges; an explore-agent audit BEFORE landing the rule
confirmed `internal/handler/v1` already imports only stdlib +
`internal/app/*` + `internal/domain/*` + `internal/handler/middleware` +
`internal/platform/httputil` + `go-chi`. No exemption is needed.
`docs/architecture/exemptions.md` therefore stays at zero rows.

## Verification

```
1. go test -v ./internal/arch/... — TestForbiddenEdges, TestHandlerV1Thinness PASS.
2. Negative test:
     "package v1`nimport _ `"github.com/ev-dev-labs/teslasync/internal/database`"" |
       Out-File -Encoding UTF8 internal/handler/v1/zzz_phase47.go
     go test -run TestHandlerV1Thinness ./internal/arch/...
   → MUST FAIL with "call internal/app/<name>svc instead".
   Remove zzz_phase47.go.
3. Negative test (adapter):
     "package v1`nimport _ `"github.com/ev-dev-labs/teslasync/internal/adapter/postgres`"" |
       Out-File -Encoding UTF8 internal/handler/v1/zzz_phase47.go
     go test -run TestHandlerV1Thinness ./internal/arch/...
   → MUST FAIL with "depend on internal/port/* interfaces instead".
   Remove zzz_phase47.go.
4. Confirm internal/api was NOT touched by the new rules:
     go test -run TestForbiddenEdges -v ./internal/arch/... 2>&1 |
       Select-String "internal/api -> "
   → ZERO matches (internal/api is exempted, the rules target handler/v1).
5. Refresh baseline.
```

## Files touched

```
ADDED:
  internal/handler/v1/example_thin_handler_test.go    (build tag phase47_example or compiling test)

MODIFIED:
  internal/arch/rules.go                              (+ 5 ForbiddenEdges; cleanup AdvisorySources)
  internal/arch/arch_test.go                          (+ TestHandlerV1Thinness)
  internal/handler/v1/doc.go                          (strengthened contract statement)
  docs/architecture/exemptions.md                     (refresh if new exemptions added)
  tools/archmetrics/baseline.json                     (refresh)
  tools/archmetrics/baseline.md                       (refresh)

DELETED:
  (none)
```

## Out of scope

- **Migrating internal/api handlers** to handler/v1 — phase-48+.
- Tightening rules for internal/handler/middleware (separate decision).
- Touching internal/api files (FROZEN).
- Adding a thinness rule to internal/api (FROZEN; rule not enforced).
- Anything under `internal/telemetry/`, `internal/tesla/`, `internal/signal/` (active phase-42).

---

## Honesty Covenant

```
<!-- BEGIN: HONESTY_COVENANT (verbatim, do not modify) -->
1. No red-as-green     — both negative tests must fail with the cited messages.
2. No scope narrowing  — all 5 ForbiddenEdges added; doc.go strengthened; example test or doc-test landed.
3. No skip-and-assume  — paste the negative-test failure messages and the green test pass.
4. No field resurrection — N/A.
5. No stubs            — TestHandlerV1Thinness must contain real assertions.
6. No delegation       — execute yourself.
7. No predecessor bypass — depends on prompts 02, 03, 06, 09.
8. No commit on red    — Gate must be GREEN.
9. No silent drift     — adding an exemption requires Until: target + exemptions.md update.
10. Log MUST contain EXIT + STATUS lines.
<!-- END: HONESTY_COVENANT -->
```

## Artifact Metadata

| Field | Value |
|-------|-------|
| Phase | 47 |
| Prompt | 10 |
| Slug | handler-thinness-rule |
| Branch | `phase-47-prompt-10-handler-thinness-rule` |
| Log | `.github/prompts/db-refactor/logs/phase-47-10-handler-thinness-rule.log` |
| Risk | LOW (rule applies only to handler/v1; existing handlers already comply) |
| Backend touched | NO (doc + arch_test + example test) |
| Frontend touched | NO |
| Migration | NO |
| Env var added | NO |
| Depends on | prompts 02, 03, 06, 09 |

## Logging Requirements

Every gate section uses `Tee-Object -FilePath $log -Append`. Final log
ends with `EXIT=<int>` + `STATUS=<DONE|BLOCKED>`.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-47-10-handler-thinness-rule.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== PHASE-47 / 10 handler-thinness-rule — $(Get-Date -Format o) ===" | Tee-Object -FilePath $log

"=== STEP 1: ARCH_TEST ===" | Tee-Object -FilePath $log -Append
go test -v ./internal/arch/... 2>&1 | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) { "EXIT=$exit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $exit }

"=== STEP 2: NEGATIVE_DATABASE ===" | Tee-Object -FilePath $log -Append
$f = "internal/handler/v1/zzz_phase47.go"
"package v1`nimport _ `"github.com/ev-dev-labs/teslasync/internal/database`"" | Out-File -Encoding UTF8 $f
$out = go test -run TestHandlerV1Thinness ./internal/arch/... 2>&1
$out | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
Remove-Item $f -Force
$outStr = ($out | Out-String)
if ($exit -eq 0) {
  "FAIL: negative-database test did not detect" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}
if ($outStr -notmatch "internal/app") {
  "FAIL: failure message did not cite internal/app" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 3: NEGATIVE_ADAPTER ===" | Tee-Object -FilePath $log -Append
$f = "internal/handler/v1/zzz_phase47.go"
"package v1`nimport _ `"github.com/ev-dev-labs/teslasync/internal/adapter/postgres`"" | Out-File -Encoding UTF8 $f
$out = go test -run TestHandlerV1Thinness ./internal/arch/... 2>&1
$out | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
Remove-Item $f -Force
$outStr = ($out | Out-String)
if ($exit -eq 0) {
  "FAIL: negative-adapter test did not detect" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}
if ($outStr -notmatch "internal/port") {
  "FAIL: failure message did not cite internal/port" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 4: API_NOT_AFFECTED ===" | Tee-Object -FilePath $log -Append
$apiHits = go test -v -run TestHandlerV1Thinness ./internal/arch/... 2>&1 | Select-String "internal/api/"
"internal/api hits in handler test: $($apiHits.Count)" | Tee-Object -FilePath $log -Append
if ($apiHits.Count -gt 0) {
  "FAIL: handler thinness rule incorrectly applied to internal/api (must be exempted)" | Tee-Object -FilePath $log -Append
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
$allowed = '^\s*[AM\?]+\s+(internal/arch/(rules|arch_test)\.go|internal/handler/v1/(doc\.go|example_thin_handler_test\.go)|docs/architecture/exemptions\.md|tools/archmetrics/baseline\.(json|md)|\.github/prompts/db-refactor/(logs/phase-47-10.*|phase-47/10-handler-thinness-rule\.prompt\.md))$'
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
chore(arch): enforce handler thinness rule on internal/handler/v1 (phase-47/10)

Adds 5 ForbiddenEdges to internal/arch/rules.go covering:
  internal/handler/v1 → internal/database          FAIL
  internal/handler/v1 → internal/platform/database FAIL
  internal/handler/v1 → internal/adapter/...       FAIL
  internal/handler/v1 → internal/models            FAIL
  internal/handler/v1 → internal/api               FAIL (FROZEN per ADR-005)

internal/api is exempt from this rule (FROZEN; existing handlers freely
query the database until per-handler migration moves them to handler/v1).

Adds TestHandlerV1Thinness with focused error messages (cite
internal/app or internal/port for the right next step).

Strengthens internal/handler/v1/doc.go contract statement.

Adds internal/handler/v1/example_thin_handler_test.go demonstrating the
canonical thin-handler shape for future contributors.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
