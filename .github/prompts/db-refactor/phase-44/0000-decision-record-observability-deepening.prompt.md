---
description: "Phase 44 - decision record locking observability deepening scope"
---

# Prompt 0000 - Decision record - Observability deepening

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-44-0000-decision-record-observability-deepening.log` |
| Depends on | `phase-43a-9999v3-final-gate.log` |
| Allowed files to change | the output log only |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1. Verify, do not assume — every claim in this log must come from a
   command's actual output.
2. No partial DONEs — STATUS=DONE means every action passed.
3. No silent skips — anything skipped is logged with `=== SKIP ===` and a
   justification.
4. Predecessor is binding — predecessor log MUST end with EXIT=0 / STATUS=DONE
   or this prompt is BLOCKED.
5. Allowed files are binding — `git status --porcelain` MUST list ONLY
   the files in "Allowed files to change".
6. Final-marker-wins — last `EXIT=` and `STATUS=` in this log determine
   pass/fail.
7. Quotation, not paraphrase — embed real command output verbatim.
8. Failure is information — write the exit and STATUS=BLOCKED, then stop.
9. NO SECRETS — never write tokens, OTLP endpoint creds, or API keys to log.
10. NO scope creep — do not modify files outside the allowed list, even
    if you find unrelated bugs.
11. **NO INSTRUMENTATION DELETIONS** — phase-44 is purely additive. Existing
    `internal/tracing/`, existing metrics, existing Jaeger config, existing
    prometheus scrape config MUST be preserved. Audit prompts (0080-0082)
    BLOCK on gaps; they NEVER `git rm` anything.
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== DECISIONS ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Phase-43 closed the data-plane rewrite. The app is now correct end-to-end,
but operationally opaque: only 3 backend files use OTel, 0 explicit spans
exist, helm has no observability deployment, no SLOs are declared, no
burn-rate alerts fire. Phase-44 fixes the operability gap.

> **2026-05-08 update — drift since authoring (2026-05-01):**
> - Backend OTel-using files: 3 → **5** (still ≪ target; observability gap is wide open)
> - `helm/` Tempo / OTel collector: still **absent**
> - `slo/catalog.yaml`: still **absent**
> - FE `@opentelemetry/*` packages: still **0**
> - `docs/runbooks/`: 5 docs (none observability)
>
> The drift is minor and additive — phase-44's design still matches
> today's gap. No re-baselining required.
>
> **ADR numbering (2026-05-08):** Phase-44 originally reserved
> `ADR-006: Observability stack`. Phase-48 has since landed `ADR-005:
> Frontend SI Cutover`, and the also-unexecuted phase-47 reserves
> ADR-006 (HTTP Handler Canonical Home) + ADR-007 (Models vs Domain
> Charter). Phase-44 has therefore been renumbered to **ADR-008** in
> all subsequent prompts. If phase-47 is skipped or executes after
> phase-44, the executor MUST collapse the gap (ADR-008 → ADR-006) by
> updating prompt 0001 + the dependent prompt headers immediately
> before execution.
>
> **Phase-47 coordination:** if phase-47 ADR-006 (HTTP Handler Canonical
> Home freeze on `internal/api`) executes first, prompts 0011 and 0020
> may be partially blocked because they create new `_test.go` files
> under `internal/api/`. Phase-47/06 has been amended to allow `_test.go`
> files for existing `internal/api/*.go` source files; verify that
> amendment is in place before executing 0011 or 0020.

This prompt records the locked decisions that govern phase-44 prompts
0001-9999. Once committed, these decisions are not negotiable inside
phase-44.

## Action Steps

1. Append a `=== DECISIONS ===` block to the log enumerating the 7 locked
   decisions verbatim (they are listed in the Gate verification below).
2. No code changes. Log only.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-44-0000-decision-record-observability-deepening.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-43a-9999v3-final-gate.log"
$prevLines = if (Test-Path $prev) { Get-Content $prev } else { @() }
$prevExit   = ($prevLines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
$prevStatus = ($prevLines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
if (-not $prevExit -or $prevExit -ne 'EXIT=0' -or -not $prevStatus -or $prevStatus -ne 'STATUS=DONE') {
  "Predecessor not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# Verify all 7 decisions are recorded verbatim.
$content = Get-Content $log -Raw
$required = @(
  'Decision 1: Observability is purely additive',
  'Decision 2: Self-hosted stack',
  'Decision 3: OpenTelemetry is the only tracing API',
  'Decision 4: SLOs are declarative',
  'Decision 5: Multi-window multi-burn-rate alerts',
  'Decision 6: Frontend RUM is in scope',
  'Decision 7: Verification floor'
)
$missing = $required | Where-Object { $content -notmatch [regex]::Escape($_) }
if ($missing) {
  "Missing required decision lines:" | Tee-Object -FilePath $log -Append
  $missing | ForEach-Object { "  - $_" | Tee-Object -FilePath $log -Append }
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

$status = git status --porcelain
$allowed = @($log)
$badLines = $status | Where-Object { $line = $_; -not ($allowed | Where-Object { $line -match [regex]::Escape($_) }) }
if ($badLines) { $badLines | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"Decisions locked." | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
exit 0
```

## Decisions to record (paste verbatim into log)

```
=== DECISIONS ===
Decision 1: Observability is purely additive. Phase-44 NEVER deletes
existing tracing, metrics, alerts, or dashboards. Cleanup prompts BLOCK on
gaps; they do not prune.

Decision 2: Self-hosted stack. Tempo for traces, Loki (existing or new) for
logs, Prometheus (existing) for metrics, Grafana (existing) for dashboards.
No external SaaS dependency in the default deployment.

Decision 3: OpenTelemetry is the only tracing API. Existing
`internal/tracing/` package is the bootstrap; all new spans use
`otel.Tracer("...")`. The legacy Jaeger client is preserved for the dev
docker-compose but receives traces via the OTel collector — direct Jaeger
SDK calls are forbidden in new code.

Decision 4: SLOs are declarative. Defined in `slo/catalog.yaml`, generated
into Prometheus recording + alerting rules and Grafana dashboards by code
generators. Hand-edited rule files are forbidden.

Decision 5: Multi-window multi-burn-rate alerts. Per Google SRE workbook:
fast burn (1h, 14.4x) pages; slow burn (6h, 6x) tickets. Single-window
"error rate > X" alerts are forbidden.

Decision 6: Frontend RUM is in scope. `@opentelemetry/sdk-trace-web` plus
fetch + route-change + error instrumentation. NO UI MUTATIONS — RUM is
added via top-level bootstrap only; no per-page changes.

Decision 7: Verification floor. Every phase-44 prompt's gate runs:
`go build ./...`, `go test -race ./...` for changed packages,
`golangci-lint run` for changed packages, `helm lint` for changed charts,
`npx tsc --noEmit` + `npm run build` for changed frontend, plus its own
prompt-specific assertions.
```

## Commit

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/logs/phase-44-0000-decision-record-observability-deepening.log
git commit -m "phase-44(0000): lock observability deepening decisions

7 decisions locked. Self-hosted Tempo, declarative SLOs, MW-MBR alerts.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
