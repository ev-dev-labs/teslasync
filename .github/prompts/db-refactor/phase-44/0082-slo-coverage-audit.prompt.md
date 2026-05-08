---
description: "Phase 44 - slo-coverage-audit"
---

# Prompt 0082 - Audit - every user-facing endpoint has an SLO

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-44-0082-slo-coverage-audit.log` |
| Depends on | `phase-44-0081-metric-coverage-audit.log` |
| Allowed files to change | `cmd/slo-coverage-audit/`, `docs/runbooks/phase-44-slo-coverage-audit.md`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-11. (See Prompt 0000.)
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT ===`, `=== BUILD ===`, `=== TESTS ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Per ADR-008 §6, every user-facing endpoint must have a matching SLO entry. Audit-only — BLOCK on gaps.

## Action Steps

1. Verify Phase 44 Prompt 0081 is DONE.
2. Write `cmd/slo-coverage-audit/main.go` that compares the user-facing route list (everything in `internal/api/router.go` not under `/internal/` or `/healthz`) against `slo/catalog.yaml`.
3. Report to `docs/runbooks/phase-44-slo-coverage-audit.md`.
4. BLOCK on any user-facing endpoint without an SLO entry. Do NOT delete endpoints.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-44-0082-slo-coverage-audit.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-44-0081-metric-coverage-audit.log"
$prevLines = if (Test-Path $prev) { Get-Content $prev } else { @() }
$prevExit   = ($prevLines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
$prevStatus = ($prevLines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
if (-not $prevExit -or $prevExit -ne 'EXIT=0' -or -not $prevStatus -or $prevStatus -ne 'STATUS=DONE') {
  "Predecessor not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

"=== AUDIT ===" | Tee-Object -FilePath $log -Append
if (-not (Test-Path "cmd/slo-coverage-audit/main.go")) { "Missing: cmd/slo-coverage-audit/main.go" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }
if (-not (Test-Path "docs/runbooks/phase-44-slo-coverage-audit.md")) { "Missing: docs/runbooks/phase-44-slo-coverage-audit.md" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

$report = Get-Content "docs/runbooks/phase-44-slo-coverage-audit.md" -Raw
if ($report -match "MISSING_SLO") { "SLO coverage gaps; BLOCK." | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

$status = git status --porcelain
$allowed = @('cmd/slo-coverage-audit/','docs/runbooks/phase-44-slo-coverage-audit.md',$log)
$badLines = $status | Where-Object { $line = $_; -not ($allowed | Where-Object { $line -match [regex]::Escape($_) }) }
if ($badLines) { $badLines | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"All gate checks passed." | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
exit 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add cmd/slo-coverage-audit/ docs/runbooks/phase-44-slo-coverage-audit.md
git add -f .github/prompts/db-refactor/logs/phase-44-0082-slo-coverage-audit.log
git commit -m "phase-44(0082): audit SLO coverage on user-facing endpoints

Audit-only; BLOCKs on endpoints without SLO entries.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
