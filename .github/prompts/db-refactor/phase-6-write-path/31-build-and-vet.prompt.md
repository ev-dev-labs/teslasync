---
description: "Phase 6 — go build + go vet for telemetry/api packages"
---

# 🔵 Write-Path 31 — Build & Vet

> **Severity:** Quality gate | **Priority:** Critical | **Prompt #:** 31 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | 2 logs (build + vet) |
| Depends on | `30-sse-payload-audit` |
| Blocks | `32-integration-test-fleet-batch` |

## Single Goal

Run `go build` + `go vet` over the affected packages. Capture logs. Hard gate before integration test.

## Recommendation

```powershell
cd D:\repos\teslasync
$logDir = ".github\prompts\db-refactor\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

go build ./internal/api/... ./internal/telemetry/... 2>&1 |
  Tee-Object -FilePath "$logDir\phase-6-31-build.log"

go vet ./internal/api/... ./internal/telemetry/... 2>&1 |
  Tee-Object -FilePath "$logDir\phase-6-31-vet.log"
```

## Acceptance Criteria

- [ ] `go build` exits 0
- [ ] `go vet` exits 0 with no warnings
- [ ] Both logs captured
- [ ] Committed

## Verification

```powershell
Get-Content .github\prompts\db-refactor\logs\phase-6-31-build.log -Tail 5
Get-Content .github\prompts\db-refactor\logs\phase-6-31-vet.log  -Tail 5
```

## Out of Scope

- Don't fix issues here — re-open the originating prompt (20–30) if a regression appears

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/logs/phase-6-31-*.log
git commit -m "test(db-refactor): Phase 6.31 — build + vet green

go build ./internal/api/... ./internal/telemetry/...
go vet   ./internal/api/... ./internal/telemetry/...

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6 prompts 20–30
