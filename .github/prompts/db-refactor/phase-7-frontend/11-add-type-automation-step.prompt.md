---
description: "Phase 7 — Add base `AutomationStepBase` + empty `AutomationStep` union skeleton"
---

# 🔵 Frontend 11 — Add base `AutomationStepBase` + empty `AutomationStep` union skeleton

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 11 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 10-add-type-automation |
| Blocks | 12-add-type-automation-full |
| ADR refs | ADR-004 |


## Single Goal

Add `AutomationStepKind` union, `AutomationStepBase`, and an `AutomationStep` discriminated-union skeleton that prompts 13–23 will extend.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export type AutomationStepKind =
  // triggers
  | 'trigger_signal'
  | 'trigger_geofence'
  | 'trigger_time'
  | 'trigger_webhook'
  // conditions
  | 'condition_signal'
  | 'condition_time_window'
  | 'condition_geofence'
  | 'condition_day_of_week'
  // actions
  | 'action_notification'
  | 'action_vehicle_command'
  | 'action_set_state';

export type AutomationStepLane = 'trigger' | 'condition' | 'action';

export interface AutomationStepBase {
  id: number;
  automation_id: number;
  kind: AutomationStepKind;
  lane: AutomationStepLane;
  position: number;
  created_at: string;
}

// Discriminated union — children added by prompts 13-23
export type AutomationStep = AutomationStepBase; // temporary; prompt 13+ will narrow
```

## Acceptance Criteria

- [ ] `AutomationStepKind` lists exactly 11 kinds
- [ ] `AutomationStepBase` present
- [ ] `AutomationStep` exported (will be narrowed by 13-23)
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern 'AutomationStepKind'
# Expected: >= 1 hit
```

## Out of Scope

- Don't add child interfaces yet (prompts 13-23)
- Don't add AutomationFull yet (prompt 12)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add AutomationStepBase + Kind union skeleton

11 step kinds across trigger/condition/action lanes. Children land in
prompts 13-23.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
