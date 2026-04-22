---
description: "Phase 7 — Add `action_notification` automation step interface"
---

# 🔵 Frontend 21 — Add `action_notification` automation step interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 21 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 20-add-type-step-condition-day-of-week |
| Blocks | 22-add-type-step-action-vehicle-command |
| ADR refs | ADR-004 |


## Single Goal

Add the CTI child interface for `kind: 'action_notification'` with typed parameter fields. No jsonb.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationStepActionNotification extends AutomationStepBase {
  kind: 'action_notification';
  lane: 'action';
  channel_id: number;
  template: string;
}
```

Then extend the `AutomationStep` discriminated union (created in prompt 11) to include this child.

## Acceptance Criteria

- [ ] Interface present with literal `kind: 'action_notification'`
- [ ] All parameter fields typed (no jsonb, no `: any`)
- [ ] Added to `AutomationStep` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "kind: 'action_notification'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't add other step kinds in this prompt
- Don't update hooks/pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add action_notification CTI step type

Typed parameters (channel_id, template); no jsonb. Adds to AutomationStep union.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
