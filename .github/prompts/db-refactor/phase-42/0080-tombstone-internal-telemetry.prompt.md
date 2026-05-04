---
description: "Phase 42 - delete internal/telemetry/"
---

# Prompt 0080 - Tombstone — `rm -rf internal/telemetry/`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42-0080-tombstone-internal-telemetry.log` |
| Depends on | `phase-42-0078-mig-drop-legacy.log`, `phase-42-0071-consumer-api-sse.log`, `phase-42-0079a-consumer-api-telemetry-handler-ingest.log` |
| Allowed files to change | All `internal/telemetry/**` (DELETIONS), the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-10. (See Prompt 0000.) Plus: this prompt only DELETES files. Any new content added by it (other than the log) is a covenant violation.
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== CALLERS_BEFORE_DELETE ===`, `=== DELETED_FILES ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`internal/telemetry/` is the legacy decode/normalize/flatten/HotCatalog package. Every consumer was migrated by prompts 0060-0071. Drop the package. Failure to delete = phase-42 left two parallel pipelines (forbidden by Decision 8).

## Action Steps

1. Verify Phase 42 Prompts 0078 AND 0071 are DONE.
2. **Caller scan first.** Search the entire repo for any remaining import of `internal/telemetry`:
   ```powershell
   git --no-pager grep -nE '"github\.com/[^"]+/internal/telemetry"' --
   ```
   Capture into `=== CALLERS_BEFORE_DELETE ===`. If any matches exist outside `internal/telemetry/` itself, FAIL with STATUS=BLOCKED — a consumer was missed.
3. `git rm -r internal/telemetry/`.
4. `go build ./...` must succeed.
5. `go vet ./...` must succeed.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-42-0080-tombstone-internal-telemetry.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

foreach ($p in @('phase-42-0078-mig-drop-legacy.log','phase-42-0071-consumer-api-sse.log')) {
  $f = ".github\prompts\db-refactor\logs\$p"
  $lines = if (Test-Path $f) { Get-Content $f } else { @() }
  $lastExit   = ($lines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
  $lastStatus = ($lines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
  if ($lastExit -ne 'EXIT=0' -or $lastStatus -ne 'STATUS=DONE') {
    "Predecessor not DONE: $p" | Tee-Object -FilePath $log -Append
    "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
  }
}

# Caller scan: nothing outside the deleted dir may import it.
$callers = git --no-pager grep -nE '"github\.com/[^"]+/internal/telemetry"' -- ':!internal/telemetry/' 2>$null
if ($callers) {
  "Refusing to delete: callers still import internal/telemetry" | Tee-Object -FilePath $log -Append
  $callers | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# Directory must actually be gone after the action ran.
if (Test-Path "internal/telemetry") {
  "internal/telemetry/ still exists" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

go build ./... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }

go vet ./... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }

# Allowed-files: only deletions inside internal/telemetry, plus the log.
$status = git status --porcelain
$badLines = $status | Where-Object {
  $line = $_
  if ($line -match [regex]::Escape($log)) { return $false }
  # Expect deletions like " D internal/telemetry/foo.go".
  if ($line -match '^\s*D\s+internal/telemetry/') { return $false }
  return $true
}
if ($badLines) { $badLines | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
exit 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A internal/telemetry
git add -f .github/prompts/db-refactor/logs/phase-42-0080-tombstone-internal-telemetry.log
git commit -m "phase-42(0080): delete internal/telemetry/ (replaced by tesla/normalize)

Forward-only per Decision 6 (no shims). All consumers migrated by
prompts 0060-0071; this commit removes the dead package.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
