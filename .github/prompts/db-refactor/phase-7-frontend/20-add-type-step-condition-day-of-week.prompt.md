---
description: "Phase 7 — Add `condition_day_of_week` automation step interface"
---

# 🔵 Frontend 20 — Add `condition_day_of_week` automation step interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 20 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 19-add-type-step-condition-geofence |
| Blocks | 21-add-type-step-action-notification |
| ADR refs | ADR-004 |


## Single Goal

Add the CTI child interface for `kind: 'condition_day_of_week'` with typed parameter fields. No jsonb.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationStepConditionDayOfWeek extends AutomationStepBase {
  kind: 'condition_day_of_week';
  lane: 'condition';
  days_of_week: number[];          // 0=Sun .. 6=Sat
  timezone: string;
}
```

Then extend the `AutomationStep` discriminated union (created in prompt 11) to include this child.

## Acceptance Criteria

- [ ] Interface present with literal `kind: 'condition_day_of_week'`
- [ ] All parameter fields typed (no jsonb, no `: any`)
- [ ] Added to `AutomationStep` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "kind: 'condition_day_of_week'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't add other step kinds in this prompt
- Don't update hooks/pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add condition_day_of_week CTI step type

Typed parameters (days_of_week[], timezone); no jsonb. Adds to AutomationStep union.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
