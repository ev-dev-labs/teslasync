---
description: "Phase 9 — Re-run Go quality gate (build, vet, test -race, lint, vulncheck)"
---

# 🔴 Acceptance 01 — Go Quality Gate

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 1 of 7

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | 6 logs, all green |
| Depends on | Phases 4–6 complete |
| Blocks | Phase 9 prompts 02–07 |

## Single Goal

Re-run every Go gate from Phase 5 prompt 06 as a final check, capturing fresh logs that Phase 9/07 will reference.

## Recommendation

```powershell
cd D:\repos\teslasync
$logDir = ".github\prompts\db-refactor\logs"

go mod tidy 2>&1 | Tee-Object -FilePath "$logDir\phase-9-01-mod-tidy.log"
go build ./... 2>&1 | Tee-Object -FilePath "$logDir\phase-9-01-build.log"
go vet ./... 2>&1 | Tee-Object -FilePath "$logDir\phase-9-01-vet.log"
go test -race -count=1 ./... 2>&1 | Tee-Object -FilePath "$logDir\phase-9-01-test.log"
golangci-lint run ./... 2>&1 | Tee-Object -FilePath "$logDir\phase-9-01-lint.log"
govulncheck ./... 2>&1 | Tee-Object -FilePath "$logDir\phase-9-01-vuln.log"
```

## Acceptance Criteria

- [ ] All 6 commands exit 0
- [ ] No new warnings vs Phase 5 prompt 06 baseline
- [ ] All 6 logs present in logs/
- [ ] Committed

## Verification

```powershell
Get-ChildItem .github\prompts\db-refactor\logs\phase-9-01-*.log |
  ForEach-Object { Write-Host "── $($_.Name) ──"; Get-Content $_.FullName -Tail 3 }
```

## Out of Scope

- Don't fix issues here (re-open the originating phase prompt if a regression appears)

## Commit When Done

```powershell
git add -f .github/prompts/db-refactor/logs/phase-9-01-*.log
git commit -m "test(db-refactor): Phase 9.01 — Go quality gate green

All 6 checks pass: mod tidy, build, vet, test -race, golangci-lint,
govulncheck. Logs captured for sign-off summary.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 5 prompt 06
