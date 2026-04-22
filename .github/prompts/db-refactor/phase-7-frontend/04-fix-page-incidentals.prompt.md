---
description: "Phase 7 — Fix every page/component referencing removed legacy fields"
---

# 🟢 Frontend 04 — Fix Page Incidentals

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 4 of 5

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | Pages and components surfaced by `tsc --noEmit` errors |
| Depends on | `01`, `02`, `03` |
| Blocks | `05-tsc-and-lint` |
| ADR refs | ADR-002, ADR-004 |

## Single Goal

Use the `tsc --noEmit` error list from prompt 03 as the worklist. For each error, replace dead-field reads with the new typed source: snapshot columns, `SignalObservation` queries, or `AutomationFull.triggers/conditions/actions`.

## What's Being Established

This is the last cleanup pass before lint/audit. After this, the frontend should compile clean and render against the new backend.

## Recommendation

### Common patterns

| Old code | New code |
|----------|----------|
| `vehicle.signals?.['BatteryLevel']` | `liveState.battery_level` (from `useVehicleLiveState`) |
| `vehicle.signals?.['ChargeState']` | `liveState.charge_state` |
| `drive.raw_json` (anywhere) | DELETE the read; use typed cols on `drives` |
| `automation.trigger_config.signal_name` | `automation.triggers[0].kind === 'trigger_signal_change' ? automation.triggers[0].signal_name : ''` (with discriminated-union narrowing) |
| `automation.conditions.map(c => c.value)` | `automation.conditions.map(c => c.kind === 'condition_signal_compare' ? c.compare_value : '')` |
| `notificationChannel.config.webhook_url` | `notificationChannel.kind === 'webhook' ? notificationChannel.url : ''` |

### Discriminated-union helper

If many sites need step type narrowing, add `web/src/lib/automations.ts`:

```typescript
import type { AutomationStep, AutomationStepKind } from '@/types/automations';

export function isStep<K extends AutomationStepKind>(
  step: AutomationStep,
  kind: K
): step is Extract<AutomationStep, { kind: K }> {
  return step.kind === kind;
}

export function findStepByKind<K extends AutomationStepKind>(
  steps: AutomationStep[],
  kind: K
): Extract<AutomationStep, { kind: K }> | undefined {
  return steps.find((s): s is Extract<AutomationStep, { kind: K }> => s.kind === kind);
}
```

Then in pages:
```tsx
const trigger = findStepByKind(automation.triggers, 'trigger_signal_change');
if (trigger) {
  // trigger.signal_name is fully typed
}
```

### Section-level rendering (don't hide whole panels)

Per project rules: every section MUST always render its panel shell. Use `EmptyState` when data isn't ready.

```tsx
// ❌ WRONG
{automation.triggers && <TriggerList triggers={automation.triggers} />}

// ✅ CORRECT
<GlassPanel className="p-6">
  <h2 className="text-lg font-semibold text-white/90">{t('automation.triggers')}</h2>
  {automation.triggers.length > 0 ? (
    <TriggerList triggers={automation.triggers} />
  ) : (
    <EmptyState message={t('automation.noTriggers', 'No triggers configured')} />
  )}
</GlassPanel>
```

### Pages most likely affected (start here)

- `web/src/features/vehicles/pages/VehicleDetailPage.tsx`
- `web/src/features/automations/pages/AutomationDetailPage.tsx`, `AutomationListPage.tsx`, automation builder
- `web/src/features/driving/pages/DriveDetailPage.tsx`
- `web/src/features/charging/pages/ChargingDetailPage.tsx`
- `web/src/features/notifications/pages/NotificationsPage.tsx` (channel config)
- Any signal-debug / dev-tools page

## Suggested Fix

1. `npx tsc --noEmit > tsc-errors.txt`
2. Group errors by file
3. Apply pattern replacements per the table above
4. Add `web/src/lib/automations.ts` helpers if 3+ sites need step narrowing
5. Re-run `tsc` after each major file fix to track progress
6. When `tsc` is clean, commit
7. Manual smoke-test the affected pages in dev (`npm run dev`)

## Acceptance Criteria

- [ ] `npx tsc --noEmit` exits with 0 errors
- [ ] No `as any` introduced to silence type errors (count must not increase from baseline)
- [ ] Discriminated-union narrowing used (no `(step as any).signal_name` shortcuts)
- [ ] Affected pages still render (manual smoke check)
- [ ] All sections show `EmptyState` when their data is absent (no `{x && <Panel>}`)
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web

# Baseline as-any count (track delta)
$asAnyBefore = (Select-String -Path src\**\*.ts*  -Pattern '\bas any\b' -SimpleMatch).Count
Write-Host "as any count: $asAnyBefore"

npx tsc --noEmit 2>&1 | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-04-tsc.log
# Expected: 0 errors

# Smoke test
npm run dev
# Open http://localhost:5173 — visit affected pages, watch console for runtime errors
```

## Out of Scope

- Don't refactor unrelated pages
- Don't add new features
- Don't change styling / Tailwind / component decomposition
- Don't run lint here (prompt 05)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git add -f .github/prompts/db-refactor/logs/phase-7-04-tsc.log
git commit -m "web(db-refactor): fix page incidentals after type refactor

Resolved all tsc --noEmit errors from prompt 03 by switching reads
from legacy fields to typed snapshot cols, SignalObservation queries,
and AutomationFull CTI children. Added lib/automations.ts helpers
for discriminated-union narrowing.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002, ADR-004
- `.github/instructions/react-frontend.instructions.md` (null safety, EmptyState rules)
