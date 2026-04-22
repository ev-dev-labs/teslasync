---
description: "Phase 7 — Add `AutomationFull` composite (parent + step lanes)"
---

# 🔵 Frontend 12 — Add `AutomationFull` composite (parent + step lanes)

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 12 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts`, `web/src/api/types.ts` (re-export) |
| Depends on | 11-add-type-automation-step |
| Blocks | 13-add-type-step-trigger-signal |
| ADR refs | ADR-004 |


## Single Goal

Add `AutomationFull` — the read shape returned by `GET /automations/:id` containing the parent plus three step lanes.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationFull extends Automation {
  triggers: AutomationStep[];
  conditions: AutomationStep[];
  actions: AutomationStep[];
}
```

### Edit `web/src/api/types.ts`

Append re-exports:
```typescript
export type {
  Automation, AutomationFull,
  AutomationStep, AutomationStepBase, AutomationStepKind, AutomationStepLane,
} from '@/types/automations';
```

## Acceptance Criteria

- [ ] `AutomationFull` extends `Automation` with 3 lane arrays
- [ ] Re-exported from `api/types.ts`
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern 'export interface AutomationFull'
# Expected: 1 hit
Select-String -Path src\api\types.ts -Pattern 'AutomationFull'
# Expected: >= 1 hit
```

## Out of Scope

- Don't add step children yet (prompts 13-23)
- Don't add hooks (prompt 33)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add AutomationFull composite read shape

What GET /automations/:id returns: parent + 3 step lane arrays.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
