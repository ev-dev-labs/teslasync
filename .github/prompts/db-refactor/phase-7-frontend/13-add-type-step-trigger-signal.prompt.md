---
description: "Phase 7 — Add `trigger_signal` automation step interface"
---

# 🔵 Frontend 13 — Add `trigger_signal` automation step interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 13 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 12-add-type-automation-full |
| Blocks | 14-add-type-step-trigger-geofence |
| ADR refs | ADR-004 |


## Single Goal

Add the CTI child interface for `kind: 'trigger_signal'` with typed parameter fields. No jsonb.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationStepTriggerSignal extends AutomationStepBase {
  kind: 'trigger_signal';
  lane: 'trigger';
  signal_name: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=' | 'changed';
  threshold_numeric: number | null;
  threshold_text: string | null;
  threshold_bool: boolean | null;
}
```

Then extend the `AutomationStep` discriminated union (created in prompt 11) to include this child.

## Acceptance Criteria

- [ ] Interface present with literal `kind: 'trigger_signal'`
- [ ] All parameter fields typed (no jsonb, no `: any`)
- [ ] Added to `AutomationStep` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "kind: 'trigger_signal'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't add other step kinds in this prompt
- Don't update hooks/pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add trigger_signal CTI step type

Typed parameters (signal_name, operator, three typed thresholds); no jsonb. Adds to AutomationStep union.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
