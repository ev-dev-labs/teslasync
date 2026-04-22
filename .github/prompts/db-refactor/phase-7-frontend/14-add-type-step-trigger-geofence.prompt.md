---
description: "Phase 7 — Add `trigger_geofence` automation step interface"
---

# 🔵 Frontend 14 — Add `trigger_geofence` automation step interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 14 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 13-add-type-step-trigger-signal |
| Blocks | 15-add-type-step-trigger-time |
| ADR refs | ADR-004 |


## Single Goal

Add the CTI child interface for `kind: 'trigger_geofence'` with typed parameter fields. No jsonb.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationStepTriggerGeofence extends AutomationStepBase {
  kind: 'trigger_geofence';
  lane: 'trigger';
  geofence_id: number;
  direction: 'enter' | 'exit' | 'either';
}
```

Then extend the `AutomationStep` discriminated union (created in prompt 11) to include this child.

## Acceptance Criteria

- [ ] Interface present with literal `kind: 'trigger_geofence'`
- [ ] All parameter fields typed (no jsonb, no `: any`)
- [ ] Added to `AutomationStep` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "kind: 'trigger_geofence'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't add other step kinds in this prompt
- Don't update hooks/pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add trigger_geofence CTI step type

Typed parameters (geofence_id, direction); no jsonb. Adds to AutomationStep union.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
