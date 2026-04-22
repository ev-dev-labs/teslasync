---
description: "Phase 7 — Add `action_vehicle_command` automation step interface"
---

# 🔵 Frontend 22 — Add `action_vehicle_command` automation step interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 22 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` |
| Depends on | 21-add-type-step-action-notification |
| Blocks | 23-add-type-step-action-set-state |
| ADR refs | ADR-004 |


## Single Goal

Add the CTI child interface for `kind: 'action_vehicle_command'` with typed parameter fields. No jsonb.

## Recommendation

### Edit `web/src/types/automations.ts`

```typescript
export interface AutomationStepActionVehicleCommand extends AutomationStepBase {
  kind: 'action_vehicle_command';
  lane: 'action';
  command: string;                 // friendly name, e.g. 'door_lock'
  /** Sole jsonb carve-out (ADR-001). Tesla command params are inherently dynamic. */
  command_params: Record<string, unknown>;
}
```

Then extend the `AutomationStep` discriminated union (created in prompt 11) to include this child.

## Acceptance Criteria

- [ ] Interface present with literal `kind: 'action_vehicle_command'`
- [ ] All parameter fields typed (no jsonb, no `: any`)
- [ ] Added to `AutomationStep` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern "kind: 'action_vehicle_command'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't add other step kinds in this prompt
- Don't update hooks/pages

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add action_vehicle_command CTI step type

Typed parameters (command, command_params (sole ADR-001 jsonb carve-out)); no jsonb. Adds to AutomationStep union.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
