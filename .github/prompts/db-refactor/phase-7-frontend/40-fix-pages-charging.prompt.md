---
description: "Phase 7 — Fix features/charging pages (drop ChargingSession.raw_json)"
---

# 🟢 Frontend 40 — Fix features/charging pages (drop ChargingSession.raw_json)

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 40 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | Files under `features/charging` flagged by `tsc --noEmit` |
| Depends on | 39-fix-pages-vehicles-and-driving |
| Blocks | 41-fix-pages-automations |
| ADR refs | ADR-001, ADR-002, ADR-004 |


## Single Goal

Resolve every tsc error in `web/src/features/charging/` caused by reads of `ChargingSession.raw_json` or untyped telemetry shape.

## Recommendation

### Step 1 — capture worklist

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-String 'features/charging' | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-40-tsc.log
```

### Step 2 — find dead-field reads

```powershell
Select-String -Path src\features/charging\**\*.tsx,src\features/charging\**\*.ts -Pattern 'raw_json|\.signals\?'
```

### Step 3 — apply replacement patterns

| Old | New |
|-----|-----|
| `session.raw_json.charger_voltage` | `telemetry.charger_voltage` (from `useChargingTelemetry`) |
| `session.raw_json.battery_level` | `telemetry.battery_level` |
| `session.signals?.['ChargeRate']` | `telemetry.charge_rate_kw` |

### Sample pages to start from

- `web/src/features/charging/pages/ChargingDetailPage.tsx`
- `web/src/features/charging/pages/ChargingListPage.tsx`

### Section rendering rule

Per project rules, every section panel MUST always render. When data is absent, show `<EmptyState message={t('...')} />` — never hide the panel with `{data && ...}`.

## Acceptance Criteria

- [ ] Zero `tsc --noEmit` errors originating from `src/features/charging/`
- [ ] No `as any` introduced in this prompt's diff
- [ ] All sections render their panel shell with `EmptyState` fallback
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-String 'features/charging'
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
git commit -m "web(db-refactor): fix features/charging pages after type refactor

Resolved tsc errors in features/charging by switching reads to typed snapshot
cols / SignalObservation / AutomationFull / typed channel configs.
All sections show EmptyState when data absent.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/instructions/react-frontend.instructions.md` (null safety, EmptyState rules)
