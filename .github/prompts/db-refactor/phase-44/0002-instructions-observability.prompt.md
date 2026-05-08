---
description: "Phase 44 - create instructions file enforcing observability rules in new code"
---

# Prompt 0002 - Instructions - Observability rules

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-44-0002-instructions-observability.log` |
| Depends on | `phase-44-0001-ADR-008-observability-stack.log` |
| Allowed files to change | `.github/instructions/observability.instructions.md` (NEW), the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-11. (See Prompt 0000.)
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== INSTRUCTIONS_WRITE ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

After phase-44 lands, every new HTTP handler / repo / Tesla client / MQTT
worker / signal pipeline stage MUST emit spans + RED metrics + (where
user-facing) carry an SLO. To make this enforceable for future agents,
create an auto-applied instructions file under `.github/instructions/`
with `applyTo: "internal/**"` frontmatter (so it loads for every backend
edit) plus `applyTo: "web/**"` for the RUM rules.

## Action Steps

1. Verify Phase 44 Prompt 0001 is DONE.
2. Create `.github/instructions/observability.instructions.md` with the
   structure listed in the Gate verification: `applyTo` frontmatter,
   "Required" section enumerating 8 patterns, "Prohibited" section
   enumerating 6 anti-patterns, "References" section linking ADR-008.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-44-0002-instructions-observability.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-44-0001-ADR-008-observability-stack.log"
$prevLines = if (Test-Path $prev) { Get-Content $prev } else { @() }
$prevExit   = ($prevLines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
$prevStatus = ($prevLines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
if (-not $prevExit -or $prevExit -ne 'EXIT=0' -or -not $prevStatus -or $prevStatus -ne 'STATUS=DONE') {
  "Predecessor not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

$f = '.github/instructions/observability.instructions.md'
if (-not (Test-Path $f)) {
  "Instructions file missing: $f" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}
$c = Get-Content $f -Raw

$required = @(
  'applyTo:',
  'internal/**',
  'web/**',
  '## Required',
  '1. Every HTTP handler creates a span via `otel.Tracer("api").Start(ctx, ...)`.',
  '2. Every repo method accepts `ctx context.Context` first and propagates it.',
  '3. Every outbound HTTP call uses `otelhttp.NewTransport`.',
  '4. Every MQTT message handler creates a span seeded from message metadata.',
  '5. Every prometheus metric has labels for `method`, `route`, `status_class`.',
  '6. Every user-facing endpoint has an SLO entry in `slo/catalog.yaml`.',
  '7. Every `.Error()` log line carries `trace_id` from the active span.',
  '8. Frontend RUM bootstraps in `web/src/main.tsx` only — never in pages.',
  '## Prohibited',
  'Direct `jaegerexporter` SDK calls in new code (use OTel collector).',
  'Hand-edited Prometheus rule files (use code generator).',
  'Single-window error-rate alerts (use MW-MBR).',
  'Spans without `defer span.End()`.',
  'Metrics with unbounded label cardinality (e.g., `vehicle_id` as label without sampling).',
  '`fmt.Errorf` in handlers without recording the error on the span.',
  '## References',
  '`.github/ARCHITECTURE.md` ADR-008'
)
$missing = $required | Where-Object { $c -notmatch [regex]::Escape($_) }
if ($missing) {
  "Missing required content:" | Tee-Object -FilePath $log -Append
  $missing | ForEach-Object { "  - $_" | Tee-Object -FilePath $log -Append }
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

$status = git status --porcelain
$allowed = @('.github/instructions/observability.instructions.md', $log)
$badLines = $status | Where-Object { $line = $_; -not ($allowed | Where-Object { $line -match [regex]::Escape($_) }) }
if ($badLines) { $badLines | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"Instructions file authored." | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
exit 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add .github/instructions/observability.instructions.md
git add -f .github/prompts/db-refactor/logs/phase-44-0002-instructions-observability.log
git commit -m "phase-44(0002): observability instructions for future agents

8 required patterns, 6 prohibited. Auto-applies to internal/** and web/**.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
