---
description: "Phase 7 — Add `condition_time_window` automation step interface"
---

# 🔵 Frontend 18 — Add `condition_time_window` automation step interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 18 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 17-add-type-step-condition-signal |
| Blocks | 19-add-type-step-condition-geofence |
| ADR refs | ADR-004 |


## Single Goal

Add the CTI child interface for `kind: 'condition_time_window'` with typed parameter fields. No jsonb.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationStepConditionTimeWindow extends AutomationStepBase {
  kind: 'condition_time_window';
  lane: 'condition';
  start_time: string;              // 'HH:MM'
  end_time: string;
  timezone: string;
}
```

Then extend the `AutomationStep` discriminated union (created in prompt 11) to include this child.

## Acceptance Criteria

- [ ] Interface present with literal `kind: 'condition_time_window'`
- [ ] All parameter fields typed (no jsonb, no `: any`)
- [ ] Added to `AutomationStep` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "kind: 'condition_time_window'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't add other step kinds in this prompt
- Don't update hooks/pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add condition_time_window CTI step type

Typed parameters (start_time, end_time, timezone); no jsonb. Adds to AutomationStep union.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
