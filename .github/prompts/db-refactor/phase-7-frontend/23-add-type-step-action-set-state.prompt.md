---
description: "Phase 7 — Add `action_set_state` automation step interface"
---

# 🔵 Frontend 23 — Add `action_set_state` automation step interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 23 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 22-add-type-step-action-vehicle-command |
| Blocks | 24-add-type-channel-discord |
| ADR refs | ADR-004 |


## Single Goal

Add the CTI child interface for `kind: 'action_set_state'` with typed parameter fields. No jsonb.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationStepActionSetState extends AutomationStepBase {
  kind: 'action_set_state';
  lane: 'action';
  state_key: string;
  state_value: string;             // serialized scalar; reader parses by convention
}
```

Then extend the `AutomationStep` discriminated union (created in prompt 11) to include this child.

## Acceptance Criteria

- [ ] Interface present with literal `kind: 'action_set_state'`
- [ ] All parameter fields typed (no jsonb, no `: any`)
- [ ] Added to `AutomationStep` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "kind: 'action_set_state'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't add other step kinds in this prompt
- Don't update hooks/pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add action_set_state CTI step type

Typed parameters (state_key, state_value); no jsonb. Adds to AutomationStep union.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
