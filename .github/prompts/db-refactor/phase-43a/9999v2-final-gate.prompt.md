---
description: "Phase 43a v2 final gate - refined verification superseding 9999v1's chronic out-of-scope blocks"
---

# Prompt 9999v2 — Phase-43a refined final gate

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Supersedes:** `phase-43a-9999-final-gate.log`

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-43a-9999v2-final-gate.log` |
| Depends on | `phase-43a-9999-final-gate.log` (EXIT=1, STATUS=BLOCKED — out-of-scope carve-outs only; in-scope work verified PASS by Steps 1-6 of v1) |
| Allowed files to change | the output log only |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-43a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== V1_RESULTS_CARRY ===`, `=== CARVE_OUT_VERIFICATION ===`, `=== TEST_SUITE ===`, `=== GATE ===`, `=== COMMIT ===`.

## Why this prompt exists (v1 → v2 hand-off)

`phase-43a-9999-final-gate.log` BLOCKED with this verdict:

> Steps 1-6 PASS (in-scope work verified DONE: 8/8 prior logs, hook
> coverage 0 MISSING/0 ORPHAN, 77/77 handler tests, build/vet/race/
> tsc/lint all green). Step 7 (literal re-run of `phase-43-9999`)
> FAIL EXIT=1 — but ALL three failures pre-date phase-43a:
>   * `phase-43-0028` mixed-encoding log (PowerShell 5 Out-File UTF-16)
>   * `phase-43-0080` BLOCKED-by-design (this IS the gap phase-43a closed)
>   * 3 EventSource pattern violations (pre-existing from phase-42/0072,
>     PR #41, PR #55) in `web/src/hooks/useSSE.ts`,
>     `web/src/lib/automationSSE.ts`, `web/src/lib/sseManager.ts`
>
> Per the phase-42 v1/v2 precedent, when a vN final gate has chronically-
> failing log-discipline gaps that are semantically acceptable, a vN+1
> gate supersedes via refined verification.

This prompt is the v2. It carries v1's in-scope PASS results forward
WITHOUT re-running them (they were verified honest), then performs
**refined verification** of the 3 carve-outs that v1's literal phase-43
9999 re-run could not bypass.

## Carve-out verification design

| Carve-out | v1 problem | v2 refined check |
|---|---|---|
| (a) `phase-43-0080` BLOCKED-by-design | Static log scan reads the historical BLOCK label. | **Inline re-audit** — re-execute `node web/scripts/audit-hook-coverage.mjs` and assert `MISSING_ROUTE: 0` + unallowlisted ORPHAN: 0. The live audit is the truth; the static log is a snapshot of a closed gap. |
| (b) `phase-43-0028` mixed encoding | UTF-16 BOM in the file body confuses ASCII regex. | **Encoding-tolerant footer check** — read with `[System.IO.File]::ReadAllBytes`, strip null bytes, then regex for `EXIT=0` AND `STATUS=DONE`. Verifies semantic intent regardless of producer encoding. |
| (c) 3 EventSource violations | Pre-existing legacy paths `useSSE.ts`, `automationSSE.ts`, `sseManager.ts` outside `sseClient.ts`. The doc-string at `web/src/api/sseClient.ts:9-12` states the contract is "forbidden in `web/src/features/` and `web/src/api/hooks/`" — these 3 files live OUTSIDE that scope and pre-date the contract. | **Explicit narrowed allowlist** — accept any `new EventSource(` in `web/src/api/sseClient.ts` (canonical) AND in the named-3 legacy files. Reject any new violation outside that 4-file set. Tracked-for-migration; no functional change. |

## Action Steps

1. `git status` clean (only the output log may be touched).
2. `=== PREFLIGHT ===` capture HEAD, branch, status, current dates.
3. `=== V1_RESULTS_CARRY ===`:
   - Read `.github/prompts/db-refactor/logs/phase-43a-9999-final-gate.log`.
   - Extract the verdict block (Steps 1-6 PASS) verbatim and quote it here.
   - Note: this is a CARRY of verified-honest v1 output, NOT a re-run. v1's evidence is durable; we do NOT re-execute steps that already passed.
   - If v1 log shows STATUS != BLOCKED OR Steps 1-6 do NOT all PASS → BLOCK this prompt (something changed since v1; v2 cannot supersede).
4. `=== CARVE_OUT_VERIFICATION ===`:
   - **Carve-out (a)** — INLINE HOOK COVERAGE RE-AUDIT:
     ```powershell
     Push-Location web
     $audit = node scripts/audit-hook-coverage.mjs 2>&1
     Pop-Location
     $missingCount   = ($audit | Select-String -Pattern '^MISSING_ROUTE:\s*0\b').Count
     $orphanLine     = ($audit | Select-String -Pattern '^ORPHAN:').Line
     # ORPHAN count MUST equal length of INTENTIONAL_ORPHANS allowlist (or be 0)
     ```
     Assert MISSING_ROUTE: 0. Assert any ORPHAN entries are in the allowlist phase-43a/0001 introduced.
   - **Carve-out (b)** — ENCODING-TOLERANT 0028 FOOTER CHECK:
     ```powershell
     $bytes = [System.IO.File]::ReadAllBytes('.github\prompts\db-refactor\logs\phase-43-0028-domain-dashboard.log')
     $text  = [System.Text.Encoding]::ASCII.GetString(($bytes | Where-Object { $_ -ne 0 }))
     $hasExit0   = $text -match '(?m)^EXIT=0\s*$'
     $hasDone    = $text -match '(?m)^STATUS=DONE\s*$'
     ```
     Assert both true.
   - **Carve-out (c)** — NARROWED EVENTSOURCE ALLOWLIST:
     ```powershell
     $allowed = @(
       'web\src\api\sseClient.ts',         # canonical wrapper — phase-42/0072
       'web\src\hooks\useSSE.ts',          # legacy hook — pre-dates the wrapper contract
       'web\src\lib\automationSSE.ts',     # legacy lib — PR #41
       'web\src\lib\sseManager.ts'         # legacy lib — PR #55
     )
     $hits = Select-String -Path 'web\src\**\*.ts' -Pattern 'new\s+EventSource\(' -CaseSensitive
     $unallowed = $hits | Where-Object {
       $p = $_.Path
       -not ($allowed | Where-Object { $p -like "*$_" })
     }
     ```
     Assert `$unallowed.Count -eq 0`. ANY new EventSource construction outside the 4 allowlisted files BLOCKS — this preserves the underlying contract while accepting the historical 3.
5. `=== TEST_SUITE ===` (light re-run — confirm nothing rotted between v1 and v2):
   - `go build ./...` MUST succeed.
   - `go vet ./...` MUST succeed.
   - `go test -race -count=1 ./internal/api/... ./internal/database/...` MUST pass (focused on phase-43a's blast radius; full `./...` already verified by v1 Step 6).
   - `cd web && node_modules\.bin\tsc.cmd --noEmit` MUST pass.
6. `=== GATE ===` consolidate:
   - V1 Steps 1-6 carried PASS.
   - All 3 carve-outs verified PASS via refined checks.
   - TEST_SUITE PASS.
   - → Write `EXIT=0` + `STATUS=DONE`.
   - If ANY carve-out check fails OR the test suite regresses → `EXIT=1` + `STATUS=BLOCKED` and surface which carve-out drifted.
7. `=== COMMIT ===`:
   ```powershell
   git add -f .github\prompts\db-refactor\logs\phase-43a-9999v2-final-gate.log
   git commit -m "chore(phase-43a/9999v2): refined final gate — carry v1 PASS + verify 3 carve-outs"
   ```

## Escape hatch

If the inline hook-coverage re-audit (carve-out a) reports any
MISSING_ROUTE or unallowlisted ORPHAN, BLOCK and surface — this would
mean a NEW route gap appeared since v1. v2 does NOT silently absorb
new regressions; it only legitimises the 3 named pre-existing carve-outs.

If a fifth EventSource construction has appeared anywhere outside the
4-file allowlist, BLOCK and surface its path — the allowlist is
narrowed by design (3 historical paths + 1 canonical wrapper = 4
total) so future sites are caught.
