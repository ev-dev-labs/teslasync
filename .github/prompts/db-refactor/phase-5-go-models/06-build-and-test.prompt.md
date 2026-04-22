---
description: "Phase 5 — Build, vet, lint, and run all Go tests (race detector on); fix everything that fails"
---

# 🔴 Models 06 — Build & Test Gate

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 6 of 6

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | Run-log + green CI |
| Depends on | All previous Phase 5 prompts |
| Blocks | Phase 6 start |
| ADR refs | (validation step) |
| Estimated effort | small (~1-3 hours, mostly waiting) |

## Single Goal

Run the full Go quality gate. Every command below must exit 0 before Phase 5 is "done" and Phase 6 may begin.

## Commands

```powershell
cd D:\repos\teslasync

go mod tidy
go build ./...
go vet  ./...
go test -race -count=1 ./...
golangci-lint run ./...
govulncheck ./...
```

## What's Being Established

Phases 5 prompts 01–05 each had local checks. This is the integration check across all of them. If 5/6 prompts were correct individually but their combination breaks, this prompt catches it.

## Suggested Fix

| Failure | Likely cause | Fix |
|---------|--------------|-----|
| `undefined: SignalObservation` | Missing model | Re-run prompt 01 with the missing struct |
| `cannot use … as type … in argument` | Pointer/value mismatch | Adjust the model field to pointer (or vice versa) |
| `pq: column "signals" does not exist` | Snapshot repo still references dropped col | Re-run prompt 05 for that repo |
| Race detector hit on `signal_catalog` cache | Concurrent map access | Add `sync.RWMutex` |
| `golangci-lint` ineffassign on `_ = err` | Discarded error | Wrap & return |
| `govulncheck` finding | Dependency CVE | Bump and rerun (not a code fix) |

## Acceptance Criteria

- [ ] `go mod tidy` produces no diff (deps already clean)
- [ ] `go build ./...` exits 0
- [ ] `go vet ./...` exits 0 with no warnings
- [ ] `go test -race -count=1 ./...` exits 0 (no flakes; rerun once if a flake is suspected)
- [ ] `golangci-lint run ./...` exits 0 (or only allow-listed warnings)
- [ ] `govulncheck ./...` exits 0
- [ ] Run-log saved
- [ ] Phase 5 marker commit produced (see below)

## Verification

```powershell
cd D:\repos\teslasync
$log = ".github/prompts/db-refactor/logs/phase-5-build-$(Get-Date -Format yyyyMMdd-HHmmss).log"
@(
  'go mod tidy',
  'go build ./...',
  'go vet ./...',
  'go test -race -count=1 ./...',
  'golangci-lint run ./...',
  'govulncheck ./...'
) | ForEach-Object {
  Write-Host "==> $_" | Tee-Object -FilePath $log -Append
  Invoke-Expression $_ 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $_"; exit 1 }
}
Write-Host "Phase 5 build gate PASS"
```

## Out of Scope

- Don't run Phase 6 changes here
- Don't run frontend tests — Phase 7
- Don't run the live integration suite (needs DB + MQTT) — that's Phase 9
- Don't bypass with `-skip` flags — fix the failures

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/logs/phase-5-build-*.log
git commit --allow-empty -m "ci(db-refactor): Phase 5 build+test gate PASS

go mod tidy clean. go build, vet, test -race, golangci-lint, govulncheck
all green. Models + repos refactor complete. Phase 6 (telemetry write
path) may begin.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- All Phase 5 prompts (01-05)
- `phase-9-acceptance/01-build-lint-go.prompt.md` (re-runs this gate as part of merge readiness)
