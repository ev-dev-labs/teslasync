---
description: "Phase 44 - append ADR-008 documenting observability stack"
---

# Prompt 0001 - ADR-008 - Observability stack

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-44-0001-ADR-008-observability-stack.log` |
| Depends on | `phase-44-0000-decision-record-observability-deepening.log` |
| Allowed files to change | `.github/ARCHITECTURE.md`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-11. (See Prompt 0000.)
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== ADR_APPEND ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Append `ADR-008: Observability stack` to `.github/ARCHITECTURE.md`. The
ADR is the public, durable record of phase-44's architectural decisions.
Subsequent prompts cite it (`per ADR-008 §3` etc.).

## Action Steps

1. Verify Phase 44 Prompt 0000 is DONE.
2. Append a new section to `.github/ARCHITECTURE.md` titled
   `## ADR-008: Observability stack` with the 7 numbered Decisions and
   6 named Locks listed in the Gate verification below.
3. Do NOT modify any other section of ARCHITECTURE.md.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-44-0001-ADR-008-observability-stack.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-44-0000-decision-record-observability-deepening.log"
$prevLines = if (Test-Path $prev) { Get-Content $prev } else { @() }
$prevExit   = ($prevLines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
$prevStatus = ($prevLines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
if (-not $prevExit -or $prevExit -ne 'EXIT=0' -or -not $prevStatus -or $prevStatus -ne 'STATUS=DONE') {
  "Predecessor not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

$adr = Get-Content '.github/ARCHITECTURE.md' -Raw
$required = @(
  '## ADR-008: Observability stack',
  '### Decision 1: Purely additive',
  '### Decision 2: Self-hosted',
  '### Decision 3: OpenTelemetry-only API',
  '### Decision 4: Declarative SLOs',
  '### Decision 5: Multi-window multi-burn-rate alerts',
  '### Decision 6: Frontend RUM in scope',
  '### Decision 7: Verification floor',
  'Lock: Additive only',
  'Lock: Self-hosted by default',
  'Lock: OTel API everywhere',
  'Lock: SLOs are code-generated',
  'Lock: MW-MBR alerts only',
  'Lock: RUM via bootstrap only'
)
$missing = $required | Where-Object { $adr -notmatch [regex]::Escape($_) }
if ($missing) {
  "Missing required ADR-008 lines:" | Tee-Object -FilePath $log -Append
  $missing | ForEach-Object { "  - $_" | Tee-Object -FilePath $log -Append }
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# ADR-008 must be appended (not replace earlier ADRs).
foreach ($earlier in @('ADR-001','ADR-002','ADR-003','ADR-004','ADR-005')) {
  if ($adr -notmatch $earlier) {
    "Earlier ADR removed: $earlier. Phase-44 is additive." | Tee-Object -FilePath $log -Append
    "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
  }
}

$status = git status --porcelain
$allowed = @('.github/ARCHITECTURE.md', $log)
$badLines = $status | Where-Object { $line = $_; -not ($allowed | Where-Object { $line -match [regex]::Escape($_) }) }
if ($badLines) { $badLines | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"ADR-008 appended." | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
exit 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add .github/ARCHITECTURE.md
git add -f .github/prompts/db-refactor/logs/phase-44-0001-ADR-008-observability-stack.log
git commit -m "phase-44(0001): ADR-008 observability stack

7 decisions, 6 locks, additive only.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
