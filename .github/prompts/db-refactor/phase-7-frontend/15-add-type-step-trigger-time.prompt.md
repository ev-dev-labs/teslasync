---
description: "Phase 7 — Add `trigger_time` automation step interface"
---

# 🔵 Frontend 15 — Add `trigger_time` automation step interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 15 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 14-add-type-step-trigger-geofence |
| Blocks | 16-add-type-step-trigger-webhook |
| ADR refs | ADR-004 |


## Single Goal

Add the CTI child interface for `kind: 'trigger_time'` with typed parameter fields. No jsonb.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationStepTriggerTime extends AutomationStepBase {
  kind: 'trigger_time';
  lane: 'trigger';
  cron_expr: string;
  timezone: string;
}
```

Then extend the `AutomationStep` discriminated union (created in prompt 11) to include this child.

## Acceptance Criteria

- [ ] Interface present with literal `kind: 'trigger_time'`
- [ ] All parameter fields typed (no jsonb, no `: any`)
- [ ] Added to `AutomationStep` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "kind: 'trigger_time'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't add other step kinds in this prompt
- Don't update hooks/pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add trigger_time CTI step type

Typed parameters (cron_expr, timezone); no jsonb. Adds to AutomationStep union.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
