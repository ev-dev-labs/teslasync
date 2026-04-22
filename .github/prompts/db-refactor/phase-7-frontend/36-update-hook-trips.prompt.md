---
description: "Phase 7 — Drop `raw_json` references in useTrips.ts"
---

# 🟢 Frontend 36 — Drop `raw_json` references in useTrips.ts

> **Severity:** Foundational | **Priority:** Medium | **Prompt #:** 36 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/hooks/useTrips.ts` |
| Depends on | 35-update-hook-charging |
| Blocks | 37-update-hook-notifications |
| ADR refs | ADR-001 |


## Single Goal

Remove every `raw_json` reference. Hook return types should rely on the cleaned `Trip` interface only.

## Recommendation

### Edit `web/src/api/hooks/useTrips.ts`

```powershell
Select-String -Path src\api\hooks\useTrips.ts -Pattern 'raw_json'
```

Delete each.

## Acceptance Criteria

- [ ] Zero `raw_json` references in `useTrips.ts`
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\hooks\useTrips.ts -Pattern 'raw_json'
# Expected: 0 hits
```

## Out of Scope

- Don't update pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): useTrips drops raw_json

Hook now relies on typed Trip interface only.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
