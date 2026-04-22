---
description: "Phase 7 — Add `condition_geofence` automation step interface"
---

# 🔵 Frontend 19 — Add `condition_geofence` automation step interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 19 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 18-add-type-step-condition-time-window |
| Blocks | 20-add-type-step-condition-day-of-week |
| ADR refs | ADR-004 |


## Single Goal

Add the CTI child interface for `kind: 'condition_geofence'` with typed parameter fields. No jsonb.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationStepConditionGeofence extends AutomationStepBase {
  kind: 'condition_geofence';
  lane: 'condition';
  geofence_id: number;
  must_be_inside: boolean;
}
```

Then extend the `AutomationStep` discriminated union (created in prompt 11) to include this child.

## Acceptance Criteria

- [ ] Interface present with literal `kind: 'condition_geofence'`
- [ ] All parameter fields typed (no jsonb, no `: any`)
- [ ] Added to `AutomationStep` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "kind: 'condition_geofence'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't add other step kinds in this prompt
- Don't update hooks/pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add condition_geofence CTI step type

Typed parameters (geofence_id, must_be_inside); no jsonb. Adds to AutomationStep union.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
