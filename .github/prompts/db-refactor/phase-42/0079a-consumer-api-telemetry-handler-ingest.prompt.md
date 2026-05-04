---
description: "Phase 42 - migrate api telemetry handler ingest off internal/telemetry"
---

# Prompt 0079a - Consumer migration — api telemetry handler ingest

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42-0079a-consumer-api-telemetry-handler-ingest.log` |
| Depends on | `phase-42-0078-mig-drop-legacy.log` |
| Allowed files to change | `internal/api/telemetry_handler_ingest.go`, `internal/api/telemetry_handler_integration_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1. No red-as-green - EXIT != 0 means STATUS=BLOCKED, no exceptions.
2. No scope narrowing - run the exact gate command, no subsets.
3. No skip-and-assume - cannot run gate means BLOCKED, never DONE.
4. No field resurrection - do not add back deleted fields to "fix" things.
5. No stubs - no `return nil`, `// TODO`, or `panic("not impl")`.
6. No delegation - NO sub-agents, NO parallel, NO background tasks.
7. No predecessor bypass - verify predecessor STATUS=DONE first.
8. No commit on red - commit only the log when BLOCKED.
9. No silent drift - `git status` outside allowed files means BLOCKED.
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on their own lines.
<!-- END COVENANT -->

## Logging Requirements

Write `=== PREFLIGHT ===`, `=== ACTION ===`, `=== CHANGES ===`, `=== GATE ===`, and `=== COMMIT ===`.

## Problem

`internal/api/telemetry_handler_ingest.go` and `internal/api/telemetry_handler_integration_test.go` are the only two remaining importers of `internal/telemetry`. They still build `[]telemetry.NamedValue` and call `telemetry.NormalizeFleetUnits`, `telemetry.Flatten`, `telemetry.CanonicalizeMap`, `telemetry.LookupHot`, `telemetry.FromMap`, and `telemetry.WriteIntoMap` to bucket atomics into hot tables (lines 95, 168-174, 379-383, 496, 509-514, 731-779, 798-800 of the ingest handler; lines 153-156 of the integration test). Per Phase 42 ADR-004 #6 (forward-only, no shims) and the architecture rule that "ALL new ingest paths route through `(*normalize.Pipeline).Process`", this code must be rewritten on top of `internal/tesla/normalize`, `internal/tesla/codec`, and `internal/tesla/router`. Until this consumer migration lands, prompt 0080 cannot delete `internal/telemetry/` and the phase-42 forward-only invariant is violated. This precursor isolates the migration so prompt 0080 can stay narrowly scoped to deletions only.

## Action Steps

1. Verify Phase 42 Prompt 0078 (`mig-drop-legacy`) is DONE.
2. Replace the package import `"github.com/ev-dev-labs/teslasync/internal/telemetry"` in both target files with the appropriate `"github.com/ev-dev-labs/teslasync/internal/tesla/normalize"`, `".../tesla/codec"`, and/or `".../tesla/router"` imports.
3. Rewrite the JSON ingest path so posted signal maps are converted to the new `codec.Atomic` (or marshalled to bytes and fed into `Pipeline.Process`) and dispatched through `(*tesla/normalize.Pipeline).Process` instead of `bucketAtomics` + `buildHotRow` + `telemetry.LookupHot`. Preserve the public `TelemetryHandler.ProcessBatch` and HTTP handler signatures (or update their callers if the signature must change, but only within the allowed-files list).
4. Replace the remaining `telemetry.NormalizeFleetUnits` / `telemetry.Flatten` / `telemetry.CanonicalizeMap` / `telemetry.FromMap` / `telemetry.WriteIntoMap` call sites with the equivalent normalize/codec/router-package calls.
5. Update `internal/api/telemetry_handler_integration_test.go`'s `fixtureBatch.NamedValues` helper (and any other helpers that still mention `telemetry.NamedValue`) to produce the new atomic/payload type or to feed bytes into `Pipeline.Process`. Keep the `//go:build integration` tag and the existing behavioral assertions unchanged.
6. Verify `go build ./...` and `go vet ./...` succeed.
7. Verify `git --no-pager grep -nE '"github\.com/[^"]+/internal/telemetry"' -- ':!internal/telemetry/'` returns zero matches so prompt 0080's caller-scan can pass on its next run.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-42-0079a-consumer-api-telemetry-handler-ingest.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-42-0078-mig-drop-legacy.log"
$prevLines = if (Test-Path $prev) { Get-Content $prev } else { @() }
$prevExit   = ($prevLines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
$prevStatus = ($prevLines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
if (-not $prevExit -or $prevExit -ne 'EXIT=0' -or -not $prevStatus -or $prevStatus -ne 'STATUS=DONE') {
  "Predecessor log missing or not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

# Allowed-file scope check (template-generated, fixer cannot modify).
$status = git status --porcelain
$allowed = @('internal/api/telemetry_handler_ingest.go', 'internal/api/telemetry_handler_integration_test.go', $log)
$badLines = $status | Where-Object {
  $line = $_
  -not ($allowed | Where-Object { $line -match [regex]::Escape($_) })
}
if ($badLines) {
  "Working tree has changes outside allowed files:" | Tee-Object -FilePath $log -Append
  $badLines | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

"All gate checks passed." | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
exit 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add internal/api/telemetry_handler_ingest.go internal/api/telemetry_handler_integration_test.go
git add -f .github/prompts/db-refactor/logs/phase-42-0079a-consumer-api-telemetry-handler-ingest.log
git commit -m "fixer-precursor(0079a): Consumer migration — api telemetry handler ingest

Auto-scaffolded precursor for phase-42-0080-tombstone-internal-telemetry.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
