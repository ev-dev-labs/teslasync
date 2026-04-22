---
description: "Phase 7 — Add `condition_signal` automation step interface"
---

# 🔵 Frontend 17 — Add `condition_signal` automation step interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 17 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 16-add-type-step-trigger-webhook |
| Blocks | 18-add-type-step-condition-time-window |
| ADR refs | ADR-004 |


## Single Goal

Add the CTI child interface for `kind: 'condition_signal'` with typed parameter fields. No jsonb.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationStepConditionSignal extends AutomationStepBase {
  kind: 'condition_signal';
  lane: 'condition';
  signal_name: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  compare_numeric: number | null;
  compare_text: string | null;
  compare_bool: boolean | null;
}
```

Then extend the `AutomationStep` discriminated union (created in prompt 11) to include this child.

## Acceptance Criteria

- [ ] Interface present with literal `kind: 'condition_signal'`
- [ ] All parameter fields typed (no jsonb, no `: any`)
- [ ] Added to `AutomationStep` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "kind: 'condition_signal'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't add other step kinds in this prompt
- Don't update hooks/pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add condition_signal CTI step type

Typed parameters (signal_name, operator, three typed comparators); no jsonb. Adds to AutomationStep union.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
