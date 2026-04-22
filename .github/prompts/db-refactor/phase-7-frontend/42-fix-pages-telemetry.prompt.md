---
description: "Phase 7 — Update features/telemetry signal viewer to use SignalObservation"
---

# 🟢 Frontend 42 — Update features/telemetry signal viewer to use SignalObservation

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 42 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | Files under `features/telemetry` flagged by `tsc --noEmit` |
| Depends on | 41-fix-pages-automations |
| Blocks | 43-fix-pages-notifications |
| ADR refs | ADR-001, ADR-002, ADR-004 |


## Single Goal

Update the signal viewer / live panel to consume `useSignalObservations` (returns typed rows) and `useSignalCatalog` (for value_type / unit metadata). Use `narrowSignal()` to surface the populated value field.

## Recommendation

### Step 1 — capture worklist

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-String 'features/telemetry' | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-42-tsc.log
```

### Step 2 — find dead-field reads

```powershell
Select-String -Path src\features/telemetry\**\*.tsx,src\features/telemetry\**\*.ts -Pattern 'useSignalsForVehicle|signals\?\.\['
```

### Step 3 — apply replacement patterns

| Old | New |
|-----|-----|
| `useSignalsForVehicle(id)` | `useSignalObservations(id, { signal_name })` |
| `signals?.[name]?.value` | `narrowSignal(obs, catalogEntry)?.value` |
| `Object.keys(signals)` | `catalog?.map(c => c.name)` for picker; observations stream separately |

### Sample pages to start from

- `web/src/features/telemetry/pages/SignalViewerPage.tsx`
- `web/src/features/telemetry/pages/LiveTelemetryPage.tsx` (or equivalent)

### Section rendering rule

Per project rules, every section panel MUST always render. When data is absent, show `<EmptyState message={t('...')} />` — never hide the panel with `{data && ...}`.

## Acceptance Criteria

- [ ] Zero `tsc --noEmit` errors originating from `src/features/telemetry/`
- [ ] No `as any` introduced in this prompt's diff
- [ ] All sections render their panel shell with `EmptyState` fallback
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-String 'features/telemetry'
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
git commit -m "web(db-refactor): fix features/telemetry pages after type refactor

Resolved tsc errors in features/telemetry by switching reads to typed snapshot
cols / SignalObservation / AutomationFull / typed channel configs.
All sections show EmptyState when data absent.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/instructions/react-frontend.instructions.md` (null safety, EmptyState rules)
