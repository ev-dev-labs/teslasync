---
description: "Phase 9 — Re-prove fresh local stack converges on TS-HA + migration 142"
---

# 🔴 Acceptance 03 — Fresh Migration Applies

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 3 of 7

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | One run-log re-validating Phase 8 prompt 03 |
| Depends on | Phase 8 complete |
| Blocks | Phase 9 prompts 04–07 |

## Single Goal

Re-execute the Phase 8 prompt 03 verification (volume wipe → fresh up → migration through 142 → hypertables/CAGGs registered) and capture a Phase-9-tagged log.

## Recommendation

Run the same 12-step PowerShell from Phase 8 prompt 03, but tee into a new log:

```powershell
$log = ".github\prompts\db-refactor\logs\phase-9-03-fresh-deploy-$(Get-Date -Format yyyyMMdd-HHmmss).log"
# (run the 12 steps, all teed to $log)
```

## Acceptance Criteria

- [ ] All 12 steps from Phase 8/03 pass again on a wiped volume
- [ ] Log saved with phase-9-03-* prefix
- [ ] Committed

## Verification

```powershell
Get-ChildItem .github\prompts\db-refactor\logs\phase-9-03-fresh-deploy-*.log |
  Select-Object -Last 1 | ForEach-Object { Get-Content $_.FullName -Tail 30 }
```

## Out of Scope

- Don't deploy to staging (Phase 10) or prod (Phase 11)

## Commit When Done

```powershell
git add -f .github/prompts/db-refactor/logs/phase-9-03-fresh-deploy-*.log
git commit -m "test(db-refactor): Phase 9.03 — fresh-deploy verification re-run on TS-HA

12-step Phase-8 verification re-executed. Migration 142 applies clean,
7 hypertables + 3 CAGGs registered, API healthy.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 8 prompt 03
