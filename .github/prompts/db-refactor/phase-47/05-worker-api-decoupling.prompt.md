# Phase-47 / Prompt 05 — Decouple workers from internal/api

## Why

`cmd/notification-worker/main.go` and `cmd/automation-worker/main.go` both
import `internal/api` (a 223-file HTTP-handler package). This is a textbook
**layering inversion**: workers don't serve HTTP, yet they depend on the
HTTP package's symbols (`api.APICallLogger`, `api.NewAsyncAPICallLogger`,
`api.AsyncLoggerOptions`, `api.APICallSinkAdapter`,
`api.NewComputedMetricEvaluator`, `api.ComputedMetricEvaluator`,
`api.ComputedMetricResult`).

The arch_test installed in prompt 02 lists this as `FORBIDDEN` and only
keeps the build green via `AllowedExceptions`. This prompt **eliminates the
exceptions** by extracting the symbols workers need into two new
purpose-named packages:

- `internal/apilog/` — the asynchronous API-call logging engine
  (`Logger`, `NewAsync`, `AsyncOptions`, `SinkAdapter`).
- `internal/notification/computed/` — the computed-metric evaluator
  (`Evaluator`, `Result`).

After extraction:

- `internal/api/` consumes the new packages (HTTP middleware wraps
  `apilog.Logger`).
- `cmd/{notification,automation}-worker` import only `internal/apilog/`
  and `internal/notification/computed/`.
- arch_test promotes the two `cmd/* → internal/api` rules from
  `AllowedException` to hard FAIL with no remaining violations.

## Evidence

```powershell
PS> Select-String -Path cmd/notification-worker/main.go -Pattern "api\."
:69:	var inboundAPILogger api.APICallLogger
:72:	inboundAPILogger = api.NewAsyncAPICallLogger(apiLogRepo, api.AsyncLoggerOptions{
:86:	notification.SetSink(api.APICallSinkAdapter(inboundAPILogger, cfg.APILogs.CaptureBodies))
:191:	computedEval := api.NewComputedMetricEvaluator(db)
:275:evaluator *api.ComputedMetricEvaluator,
:336:result api.ComputedMetricResult,

PS> Select-String -Path cmd/automation-worker/main.go -Pattern "api\."
:72:	var inboundAPILogger api.APICallLogger
:75:	inboundAPILogger = api.NewAsyncAPICallLogger(apiLogRepo, api.AsyncLoggerOptions{
:89:	outboundAPILogSink := api.APICallSinkAdapter(inboundAPILogger, cfg.APILogs.CaptureBodies)

PS> Select-String -Path internal/api/api_call_log_middleware.go -Pattern "^func "
:137:func NewAsyncAPICallLogger(...) APICallLogger
:270:func SetAPICallLogger(l APICallLogger) APICallLogger
:606:func APICallSinkAdapter(...) httputil.APICallSink

PS> Select-String -Path internal/api/computed_metric_evaluator.go -Pattern "^func "
:31:func NewComputedMetricEvaluator(db *database.DB) *ComputedMetricEvaluator
```

The middleware file mixes (a) the logger engine — pure data, no HTTP
knowledge — with (b) the HTTP middleware that calls it. Only (a) leaves
the package; (b) stays.

## Design

### Step 1 — `internal/apilog/`

New package layout:

```
internal/apilog/
  doc.go         // Layer: platform
  logger.go      // type Logger interface; NoOp implementation
  async.go       // NewAsync(...), AsyncOptions, the goroutine pump
  sink.go        // SinkAdapter wraps Logger as httputil.APICallSink
  logger_test.go // moved from internal/api/api_call_log_middleware_test.go where applicable
```

Public API (preserve names where reasonable; rename only where the old
name had `API` redundancy):

| Old (`internal/api`) | New (`internal/apilog`) |
|---|---|
| `APICallLogger` | `Logger` |
| `NewAsyncAPICallLogger` | `NewAsync` |
| `AsyncLoggerOptions` | `AsyncOptions` |
| `APICallSinkAdapter` | `SinkAdapter` |
| `SetAPICallLogger` | (stays in `internal/api`; sets the global handler-side logger) |
| `APICallLogBatchInserter` | `BatchInserter` |

The renames are a one-time clean-up. Each old name becomes a deprecated
alias in `internal/api/api_call_log_middleware.go` for a single release:

```go
// Deprecated: use apilog.Logger. Will be removed in phase-48.
type APICallLogger = apilog.Logger

// Deprecated: use apilog.NewAsync.
var NewAsyncAPICallLogger = apilog.NewAsync
// ... etc
```

This lets the workers migrate without breaking any other consumers in
`internal/api/` that haven't been refactored yet.

### Step 2 — `internal/notification/computed/`

```
internal/notification/computed/
  doc.go          // Layer: platform
  evaluator.go    // type Evaluator; func New(db); Result
  evaluator_test.go
```

Renames:

| Old (`internal/api`) | New (`internal/notification/computed`) |
|---|---|
| `ComputedMetricEvaluator` | `Evaluator` |
| `NewComputedMetricEvaluator` | `New` |
| `ComputedMetricResult` | `Result` |

Same deprecated-alias treatment in `internal/api/computed_metric_evaluator.go`:

```go
// Deprecated: use computed.Evaluator. Will be removed in phase-48.
type ComputedMetricEvaluator = computed.Evaluator
var NewComputedMetricEvaluator = computed.New
type ComputedMetricResult = computed.Result
```

### Step 3 — update worker mains

`cmd/notification-worker/main.go`: replace 6 `api.X` references with
`apilog.X` / `computed.X`. Remove the `internal/api` import. Remove the
deprecated alias usage entirely (workers go straight to the new packages).

```go
import (
	"github.com/ev-dev-labs/teslasync/internal/apilog"
	"github.com/ev-dev-labs/teslasync/internal/notification/computed"
)

var inboundAPILogger apilog.Logger
if cfg.APILogs.Enabled {
	inboundAPILogger = apilog.NewAsync(apiLogRepo, apilog.AsyncOptions{
		QueueCapacity: cfg.APILogs.QueueCapacity,
		BatchSize:     cfg.APILogs.BatchSize,
		FlushInterval: cfg.APILogs.FlushInterval,
	})
}
notification.SetSink(apilog.SinkAdapter(inboundAPILogger, cfg.APILogs.CaptureBodies))
// ...
computedEval := computed.New(db)
```

`cmd/automation-worker/main.go`: identical pattern, remove the
`internal/api` import.

### Step 4 — update `internal/api/` consumers

`internal/api/api_call_log_middleware.go` (the HTTP-facing wrapper) keeps
its public API (since the deprecated aliases preserve compatibility) but
internally delegates to `apilog`:

```go
package api

import "github.com/ev-dev-labs/teslasync/internal/apilog"

func NewAsyncAPICallLogger(inserter APICallLogBatchInserter, opts AsyncLoggerOptions) APICallLogger {
	return apilog.NewAsync(inserter, apilog.AsyncOptions(opts))
}
```

Or simpler — delete the duplicated code and keep ONLY the type aliases.
Executor's call (whichever yields fewer LOC).

### Step 5 — update `internal/app/new.go` (from prompt 04)

If prompt 04 has already landed, its `initAPILogging()` method currently
uses `api.NewAsyncAPICallLogger`. Update to `apilog.NewAsync`. (If 04 has
NOT yet landed, this prompt updates `cmd/teslasync/main.go` directly with
the same substitution and prompt 04 picks up the cleaner symbols.)

### Step 6 — promote arch_test rules from advisory → hard FAIL

In `internal/arch/rules.go`, REMOVE the two `AllowedExceptions` entries
and confirm the `ForbiddenEdges` entries remain. The test should now FAIL
if any worker re-introduces the import.

```go
var AllowedExceptions = []Exception{
	// (cleared by phase-47/05; previous workers→api exemptions are now hard FAIL)
}
```

### Step 7 — update README.md or CHANGELOG

If there is a `docs/CHANGELOG.md` or `docs/upgrade.md`, append a deprecation
notice for the renamed symbols (callable in any external integration code).

## Verification

```
1. go build ./... — must succeed (deprecated aliases keep old call sites valid).
2. go vet ./... — clean.
3. go test -race ./internal/apilog/... ./internal/notification/computed/... ./internal/api/... ./cmd/notification-worker/... ./cmd/automation-worker/...
   → all pass.
4. Confirm no import of internal/api remains in workers:
     Select-String -Path cmd/notification-worker/main.go -Pattern "internal/api"
     Select-String -Path cmd/automation-worker/main.go   -Pattern "internal/api"
   → both must produce ZERO results.
5. arch_test.go must PASS with NO AllowedExceptions entries:
     go test -v ./internal/arch/...
   → expect TestForbiddenEdges PASS.
6. Smoke-start each worker against a throwaway DB:
     $env:TESLASYNC_DB_URL = "postgres://test@localhost:5432/teslasync_test"
     go build -o nw.exe ./cmd/notification-worker
     Start-Process .\nw.exe
     Start-Sleep 5
     Get-Process nw -ErrorAction SilentlyContinue | Stop-Process -Force
     Remove-Item nw.exe
   (Repeat for automation-worker.)
7. Refresh baseline:
     go run ./tools/archmetrics > tools/archmetrics/baseline.json
   → forbidden_edges array MUST be empty.
8. Confirm deprecated aliases still resolve from external callers:
     New-Item -ItemType File _smoke.go
     @'
     package main
     import "github.com/ev-dev-labs/teslasync/internal/api"
     var _ api.APICallLogger
     var _ = api.NewAsyncAPICallLogger
     func main() {}
     '@ | Out-File _smoke.go
     go build _smoke.go
     Remove-Item _smoke.go _smoke.exe -ErrorAction SilentlyContinue
   → must build clean.
```

## Files touched

```
ADDED:
  internal/apilog/doc.go
  internal/apilog/logger.go
  internal/apilog/async.go
  internal/apilog/sink.go
  internal/apilog/logger_test.go         (any tests relocated from internal/api)
  internal/notification/computed/doc.go
  internal/notification/computed/registry.go
  internal/notification/computed/compare.go
  internal/notification/computed/evaluator.go
  internal/notification/computed/evaluator_test.go

MODIFIED:
  cmd/notification-worker/main.go        (remove internal/api import; use apilog + computed)
  cmd/automation-worker/main.go          (remove internal/api import; use apilog)
  internal/api/api_call_log_middleware.go (delegate to apilog; keep deprecated aliases)
  internal/api/api_call_log_middleware_test.go (apiCallLogDropsCounter → apilog.DropsCounter)
  internal/api/computed_metric_evaluator.go (deprecated aliases delegating to computed package)
  internal/api/computed_metrics.go       (deprecated aliases delegating to computed package — registry + WindowBounds + CompareMetric et al moved with the evaluator)
  internal/arch/rules.go                 (remove 2 AllowedExceptions for cmd/<worker>→internal/api)
  tools/archmetrics/baseline.json        (refresh; forbidden_edges should be [])
  tools/archmetrics/baseline.md          (refresh)
  internal/app/new.go                    (api.NewAsyncAPICallLogger / api.AsyncLoggerOptions / api.APICallSinkAdapter → apilog.NewAsync / apilog.AsyncOptions / apilog.SinkAdapter)
  .github/prompts/db-refactor/phase-47/05-worker-api-decoupling.prompt.md (allowed-files regex extended to cover computed_metrics.go, the test file, and this prompt itself — Honesty Covenant rule 9 scope correction)

DELETED:
  internal/api/computed_metric_evaluator_test.go (test moved to internal/notification/computed/evaluator_test.go in the same commit; gate STEP 7 regex updated to allow the D status)
```

## Out of scope

- Removing the deprecated aliases — defer to phase-48 once internal/api is fully migrated.
- Refactoring `internal/api/api_call_log_middleware.go` HTTP middleware itself (the `Middleware()` func that wraps http.Handler) — stays in `internal/api`.
- Splitting `internal/notification/` into more subpackages — only `computed/` is created here.
- cmd/export-worker — does NOT import `internal/api` (verified); leave alone.
- Anything under `internal/telemetry/`, `internal/tesla/`, `internal/signal/` (active phase-42 territory).

---

## Honesty Covenant

```
<!-- BEGIN: HONESTY_COVENANT (verbatim, do not modify) -->
1. No red-as-green     — verification step 4 is binary: ZERO matches for "internal/api" in worker mains.
2. No scope narrowing  — both workers must be migrated; both AllowedExceptions removed.
3. No skip-and-assume  — paste output of grep, go test, smoke-start.
4. No field resurrection — the old API* names survive ONLY as deprecated aliases; do not re-add new code under those names.
5. No stubs            — every extracted func/type must contain real logic, not "// TODO copy from internal/api".
6. No delegation       — execute yourself.
7. No predecessor bypass — depends on prompts 01, 02, 03; soft-depends on 04.
8. No commit on red    — Gate must be GREEN; arch_test must show zero violations + zero exceptions for the worker→api rules.
9. No silent drift     — if you discover ANOTHER worker import of internal/api during execution, STOP and update this prompt before extracting it.
10. Log MUST contain EXIT + STATUS lines.
<!-- END: HONESTY_COVENANT -->
```

## Artifact Metadata

| Field | Value |
|-------|-------|
| Phase | 47 |
| Prompt | 05 |
| Slug | worker-api-decoupling |
| Branch | `phase-47-prompt-05-worker-api-decoupling` |
| Log | `.github/prompts/db-refactor/logs/phase-47-05-worker-api-decoupling.log` |
| Risk | MEDIUM (relocates code; deprecated aliases preserve callers) |
| Backend touched | YES (extract; deprecated aliases) |
| Frontend touched | NO |
| Migration | NO |
| Env var added | NO |
| Depends on | prompts 01, 02, 03; soft on 04 |

## Logging Requirements

Every gate section uses `Tee-Object -FilePath $log -Append`. Final log
ends with `EXIT=<int>` + `STATUS=<DONE|BLOCKED>`.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-47-05-worker-api-decoupling.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== PHASE-47 / 05 worker-api-decoupling — $(Get-Date -Format o) ===" | Tee-Object -FilePath $log

"=== STEP 1: NO_API_IMPORT_IN_WORKERS ===" | Tee-Object -FilePath $log -Append
$nw = Select-String -Path cmd/notification-worker/main.go -Pattern '"github.com/ev-dev-labs/teslasync/internal/api"'
$aw = Select-String -Path cmd/automation-worker/main.go   -Pattern '"github.com/ev-dev-labs/teslasync/internal/api"'
"notification-worker matches: $($nw.Count)" | Tee-Object -FilePath $log -Append
"automation-worker matches: $($aw.Count)" | Tee-Object -FilePath $log -Append
if ($nw.Count -gt 0 -or $aw.Count -gt 0) {
  "FAIL: workers still import internal/api" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 2: GO_BUILD ===" | Tee-Object -FilePath $log -Append
go build ./... 2>&1 | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) { "EXIT=$exit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $exit }

"=== STEP 3: GO_VET ===" | Tee-Object -FilePath $log -Append
go vet ./... 2>&1 | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) { "EXIT=$exit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $exit }

"=== STEP 4: GO_TEST_RACE ===" | Tee-Object -FilePath $log -Append
go test -race ./internal/apilog/... ./internal/notification/computed/... ./internal/api/... ./cmd/notification-worker/... ./cmd/automation-worker/... 2>&1 | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) { "EXIT=$exit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $exit }

"=== STEP 5: ARCH_TEST_NO_EXCEPTIONS ===" | Tee-Object -FilePath $log -Append
$exceptions = Select-String -Path internal/arch/rules.go -Pattern "cmd/(notification|automation)-worker.*internal/api"
"residual worker→api exceptions in rules.go: $($exceptions.Count)" | Tee-Object -FilePath $log -Append
if ($exceptions.Count -gt 0) {
  "FAIL: AllowedExceptions still lists worker→api edges" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}
go test -v ./internal/arch/... 2>&1 | Tee-Object -FilePath $log -Append
$exit = $LASTEXITCODE
if ($exit -ne 0) { "EXIT=$exit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $exit }

"=== STEP 6: REFRESH_BASELINE ===" | Tee-Object -FilePath $log -Append
go run ./tools/archmetrics > tools/archmetrics/baseline.json 2>&1
go run ./tools/archmetrics -report > tools/archmetrics/baseline.md 2>&1
$bl = Get-Content tools/archmetrics/baseline.json | ConvertFrom-Json
"forbidden_edges count = $($bl.forbidden_edges.Count)" | Tee-Object -FilePath $log -Append
if ($bl.forbidden_edges.Count -gt 0) {
  "FAIL: baseline still shows forbidden edges" | Tee-Object -FilePath $log -Append
  $bl.forbidden_edges | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"=== STEP 7: GIT_STATUS ===" | Tee-Object -FilePath $log -Append
$status = git status --porcelain
$status | Tee-Object -FilePath $log -Append
$allowed = '^\s*[AMD\?]+\s+(internal/apilog/.*|internal/notification/computed/.*|internal/api/(api_call_log_middleware|computed_metric_evaluator|computed_metrics).*\.go|cmd/(notification|automation)-worker/main\.go|internal/arch/rules\.go|internal/app/new\.go|tools/archmetrics/baseline\.(json|md)|\.github/prompts/db-refactor/(logs/phase-47-05.*|phase-47/05-worker-api-decoupling\.prompt\.md))$'
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
refactor(arch): decouple workers from internal/api via internal/apilog + computed (phase-47/05)

Eliminates cmd/notification-worker → internal/api and cmd/automation-worker
→ internal/api import edges (PA layering inversion).

Extracts:
  internal/apilog/                    — async API-call logging engine
    Logger / NewAsync / AsyncOptions / SinkAdapter / BatchInserter
  internal/notification/computed/     — computed metric evaluator for alerts
    Evaluator / New / Result

internal/api retains the old names as deprecated aliases for one release:
  type APICallLogger = apilog.Logger          // Deprecated
  var NewAsyncAPICallLogger = apilog.NewAsync // Deprecated
  type ComputedMetricEvaluator = computed.Evaluator  // Deprecated

internal/arch/rules.go: removes the 2 AllowedExceptions for the worker→api
edges; arch_test now FAILS if any worker re-introduces the import.

baseline.json forbidden_edges count: 2 → 0.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
