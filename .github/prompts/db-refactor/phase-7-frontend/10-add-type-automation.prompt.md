---
description: "Phase 7 — Add base `Automation` interface (parent row)"
---

# 🔵 Frontend 10 — Add base `Automation` interface (parent row)

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 10 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/automations.ts` (new) |
| Depends on | 09-add-type-signal-discriminated-union |
| Blocks | 11-add-type-automation-step |
| ADR refs | ADR-004 |


## Single Goal

Create `web/src/types/automations.ts` with the base `Automation` interface mirroring the Phase 3 `automations` parent row.

## Recommendation

### Create `web/src/types/automations.ts`

```typescript
export interface Automation {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  vehicle_id: number | null;       // null = applies to all vehicles
  created_at: string;
  updated_at: string;
}
```

## Acceptance Criteria

- [ ] File created
- [ ] `Automation` parent shape only (no steps yet)
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\automations.ts -Pattern 'export interface Automation\b'
# Expected: 1 hit
```

## Out of Scope

- Don't add step types yet (prompts 11-23)
- Don't add hooks

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add Automation parent type

Mirrors Phase 3 automations table parent row.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
