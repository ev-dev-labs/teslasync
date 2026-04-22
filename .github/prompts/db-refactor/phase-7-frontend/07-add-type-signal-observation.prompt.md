---
description: "Phase 7 — Add `SignalObservation` interface (cold-path tall row)"
---

# 🔵 Frontend 07 — Add `SignalObservation` interface (cold-path tall row)

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 7 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/signals.ts` (new), `web/src/api/types.ts` (re-export) |
| Depends on | 06-update-types-cleanup-any |
| Blocks | 08-add-type-signal-catalog-entry |
| ADR refs | ADR-002 |


## Single Goal

Create `web/src/types/signals.ts` with the `SignalObservation` interface mirroring Phase 3 `signal_observations` hypertable rows.

## Recommendation

### Create `web/src/types/signals.ts`

```typescript
export type SignalSource = 'fleet_telemetry' | 'fleet_api' | 'manual' | 'backfill';

export interface SignalObservation {
  vehicle_id: number;
  ts: string;                      // ISO timestamp
  signal_name: string;
  value_numeric: number | null;    // mutually exclusive with value_text/value_bool
  value_text: string | null;
  value_bool: boolean | null;
  source: SignalSource;
}
```

### Edit `web/src/api/types.ts`

Append:
```typescript
export type { SignalObservation, SignalSource } from '@/types/signals';
```

## Acceptance Criteria

- [ ] `web/src/types/signals.ts` exists
- [ ] `SignalObservation` has exactly the 7 fields above
- [ ] Re-exported from `api/types.ts`
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\signals.ts -Pattern 'export interface SignalObservation'
# Expected: 1 hit
Select-String -Path src\api\types.ts -Pattern "export type \{ SignalObservation"
# Expected: 1 hit
```

## Out of Scope

- Don't add SignalCatalogEntry yet (prompt 08)
- Don't add discriminated union helper (prompt 09)
- Don't add hooks (prompt 32)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add SignalObservation type

Mirrors Phase 3 signal_observations hypertable: 3 mutually-exclusive
value columns, source enum, no jsonb.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
