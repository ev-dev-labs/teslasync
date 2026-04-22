---
description: "Phase 7 — Verify snapshot hooks match new typed columns"
---

# 🟢 Frontend 38 — Verify snapshot hooks match new typed columns

> **Severity:** Foundational | **Priority:** Medium | **Prompt #:** 38 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/hooks/useVehicleSystems.ts` |
| Depends on | 37-update-hook-notifications |
| Blocks | 39-fix-pages-vehicles-and-driving |
| ADR refs | ADR-001, ADR-002 |


## Single Goal

Walk every hook in `useVehicleSystems.ts` and confirm its return type is the typed snapshot interface from prompt 05 (Position, ClimateSnapshot, MotorSnapshot, SecurityEvent, VehicleMetaSnapshot). Remove any leftover `raw_json` / `signals` / `Record<string, any>` references.

## Recommendation

### Recipe

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\hooks\useVehicleSystems.ts -Pattern 'raw_json|signals\?:|Record<string,\s*any>'
```

For each hit:
- Replace with the typed snapshot interface from `api/types.ts`
- Confirm queryFn URL has no `/api/v1/` prefix
- Confirm any query params are snake_case

## Acceptance Criteria

- [ ] Zero `raw_json` / `signals?:` / `Record<string, any>` in this file
- [ ] All snapshot hooks use typed interfaces
- [ ] No `/api/v1/` prefix; snake_case params
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\hooks\useVehicleSystems.ts -Pattern 'raw_json|signals\?:|Record<string,\s*any>'
# Expected: 0 hits
```

## Out of Scope

- Don't update consumer pages (prompts 39-43)
- Don't add new snapshot kinds

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): useVehicleSystems hooks use typed snapshot shapes

Position/Climate/Motor/Security/VehicleMeta hook returns now mirror
Phase 3 typed columns exactly.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
