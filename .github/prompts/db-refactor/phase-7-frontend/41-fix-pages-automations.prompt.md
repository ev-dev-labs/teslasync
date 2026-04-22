---
description: "Phase 7 — Rewrite features/automations pages for CTI shape"
---

# 🟢 Frontend 41 — Rewrite features/automations pages for CTI shape

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 41 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | Files under `features/automations` flagged by `tsc --noEmit` |
| Depends on | 40-fix-pages-charging |
| Blocks | 42-fix-pages-telemetry |
| ADR refs | ADR-001, ADR-002, ADR-004 |


## Single Goal

Rewrite the automation list/detail/builder pages so they consume `AutomationFull` with discriminated-union step children. No more `automation.trigger_config.*` or `automation.conditions[i].value` patterns.

## Recommendation

### Step 1 — capture worklist

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-String 'features/automations' | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-41-tsc.log
```

### Step 2 — find dead-field reads

```powershell
Select-String -Path src\features/automations\**\*.tsx,src\features/automations\**\*.ts -Pattern 'trigger_config|conditions\[|actions\[.*\]\.value|raw_json'
```

### Step 3 — apply replacement patterns

| Old | New |
|-----|-----|
| `automation.trigger_config.signal_name` | narrow on `automation.triggers[0].kind === 'trigger_signal'` then `.signal_name` |
| `automation.conditions.map(c => c.value)` | narrow on each `c.kind` and read the typed comparator field |
| `automation.actions.map(a => a.command)` | narrow on `a.kind === 'action_vehicle_command'` then `.command` |

Optionally add `web/src/lib/automations.ts`:

```typescript
import type { AutomationStep, AutomationStepKind } from '@/types/automations';

export function isStep<K extends AutomationStepKind>(
  step: AutomationStep, kind: K,
): step is Extract<AutomationStep, { kind: K }> {
  return step.kind === kind;
}

export function findStepByKind<K extends AutomationStepKind>(
  steps: AutomationStep[], kind: K,
): Extract<AutomationStep, { kind: K }> | undefined {
  return steps.find((s): s is Extract<AutomationStep, { kind: K }> => s.kind === kind);
}
```

### Sample pages to start from

- `web/src/features/automations/pages/AutomationListPage.tsx`
- `web/src/features/automations/pages/AutomationDetailPage.tsx`
- `web/src/features/automations/pages/AutomationBuilderPage.tsx` (or equivalent)
- Any step-form sub-components

### Section rendering rule

Per project rules, every section panel MUST always render. When data is absent, show `<EmptyState message={t('...')} />` — never hide the panel with `{data && ...}`.

## Acceptance Criteria

- [ ] Zero `tsc --noEmit` errors originating from `src/features/automations/`
- [ ] No `as any` introduced in this prompt's diff
- [ ] All sections render their panel shell with `EmptyState` fallback
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-String 'features/automations'
# Expected: 0 hits
```

## Out of Scope

- Don't refactor unrelated pages
- Don't restyle / change Tailwind classes
- Don't run lint here (prompt 44)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): fix features/automations pages after type refactor

Resolved tsc errors in features/automations by switching reads to typed snapshot
cols / SignalObservation / AutomationFull / typed channel configs.
All sections show EmptyState when data absent.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/instructions/react-frontend.instructions.md` (null safety, EmptyState rules)
