---
description: "Phase 7 — Drop `raw_json` from Trip"
---

# 🟢 Frontend 04 — Drop `raw_json` from Trip

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 4 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/types.ts` |
| Depends on | 03-update-types-charging |
| Blocks | 05-update-types-snapshots |
| ADR refs | ADR-001 |


## Single Goal

Remove `raw_json?: unknown` from the `Trip` interface.

## Recommendation

### Edit `web/src/api/types.ts`

```typescript
// REMOVE from Trip interface:
//   raw_json?: unknown;
```

## Acceptance Criteria

- [ ] `Trip.raw_json` deleted
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\types.ts -Pattern 'Trip[\s\S]{0,200}raw_json'
# Expected: 0 hits
```

## Out of Scope

- Don't update useTrips hook here (prompt 36)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): drop Trip.raw_json

Trip relies on typed columns only.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
