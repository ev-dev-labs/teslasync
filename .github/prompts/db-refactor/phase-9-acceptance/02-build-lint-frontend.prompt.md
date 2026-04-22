---
description: "Phase 9 — Re-run frontend quality gate (tsc, lint, audit_code, build, test)"
---

# 🔴 Acceptance 02 — Frontend Quality Gate

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 2 of 7

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | 5 logs, all green |
| Depends on | Phase 7 complete |
| Blocks | Phase 9 prompts 03–07 |

## Single Goal

Re-run every frontend gate from Phase 7 prompt 05 as a final check.

## Recommendation

```powershell
cd D:\repos\teslasync\web
$logDir = "..\.github\prompts\db-refactor\logs"

npx tsc --noEmit 2>&1 | Tee-Object -FilePath "$logDir\phase-9-02-tsc.log"
npm run lint    2>&1 | Tee-Object -FilePath "$logDir\phase-9-02-lint.log"
# audit_code via MCP tool — output captured to:
#   $logDir\phase-9-02-audit.log
npm run build   2>&1 | Tee-Object -FilePath "$logDir\phase-9-02-build.log"
npm test -- --run 2>&1 | Tee-Object -FilePath "$logDir\phase-9-02-test.log"
```

## Acceptance Criteria

- [ ] All 5 gates exit 0
- [ ] audit_code reports 0 violations
- [ ] All 5 logs present
- [ ] Committed

## Verification

```powershell
Get-ChildItem .github\prompts\db-refactor\logs\phase-9-02-*.log |
  ForEach-Object { Write-Host "── $($_.Name) ──"; Get-Content $_.FullName -Tail 3 }
```

## Out of Scope

- Don't fix issues here (re-open Phase 7 prompts)

## Commit When Done

```powershell
git add -f .github/prompts/db-refactor/logs/phase-9-02-*.log
git commit -m "test(db-refactor): Phase 9.02 — Frontend quality gate green

All 5 checks pass: tsc, lint, audit_code, build, test. Logs captured.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 7 prompt 05
