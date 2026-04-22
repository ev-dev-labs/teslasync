---
description: "Phase 7 — Add `trigger_webhook` automation step interface"
---

# 🔵 Frontend 16 — Add `trigger_webhook` automation step interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 16 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 15-add-type-step-trigger-time |
| Blocks | 17-add-type-step-condition-signal |
| ADR refs | ADR-004 |


## Single Goal

Add the CTI child interface for `kind: 'trigger_webhook'` with typed parameter fields. No jsonb.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationStepTriggerWebhook extends AutomationStepBase {
  kind: 'trigger_webhook';
  lane: 'trigger';
  webhook_token: string;           // server-generated opaque token
  require_signature: boolean;
}
```

Then extend the `AutomationStep` discriminated union (created in prompt 11) to include this child.

## Acceptance Criteria

- [ ] Interface present with literal `kind: 'trigger_webhook'`
- [ ] All parameter fields typed (no jsonb, no `: any`)
- [ ] Added to `AutomationStep` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "kind: 'trigger_webhook'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't add other step kinds in this prompt
- Don't update hooks/pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add trigger_webhook CTI step type

Typed parameters (webhook_token, require_signature); no jsonb. Adds to AutomationStep union.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
