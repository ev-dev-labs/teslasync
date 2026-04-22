---
description: "Phase 7 — Drop `raw_json` references in useDriving.ts"
---

# 🟢 Frontend 34 — Drop `raw_json` references in useDriving.ts

> **Severity:** Foundational | **Priority:** Medium | **Prompt #:** 34 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/hooks/useDriving.ts` |
| Depends on | 33-update-hook-automations |
| Blocks | 35-update-hook-charging |
| ADR refs | ADR-001 |


## Single Goal

Ensure no return type or in-hook code touches `Drive.raw_json`. Verify `useDrives`, `useDrive`, `useDriveTelemetry` all use typed `Drive` shape from `api/types.ts`.

## Recommendation

### Edit `web/src/api/hooks/useDriving.ts`

```powershell
Select-String -Path src\api\hooks\useDriving.ts -Pattern 'raw_json'
```

For each hit, delete the reference. The hook should rely entirely on the typed `Drive` interface (cleaned in prompt 02).

## Acceptance Criteria

- [ ] `useDriving.ts` contains 0 references to `raw_json`
- [ ] Hook return types reference `Drive` (typed)
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\hooks\useDriving.ts -Pattern 'raw_json'
# Expected: 0 hits
```

## Out of Scope

- Don't update pages (prompt 39)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): useDriving drops raw_json

Hook now relies on typed Drive interface only.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
