---
description: "Phase 7 — Add `SignalCatalogEntry` interface"
---

# 🔵 Frontend 08 — Add `SignalCatalogEntry` interface

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 8 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/signals.ts`, `web/src/api/types.ts` (re-export) |
| Depends on | 07-add-type-signal-observation |
| Blocks | 09-add-type-signal-discriminated-union |
| ADR refs | ADR-002, ADR-009 |


## Single Goal

Append `SignalCatalogEntry` to `web/src/types/signals.ts` matching Phase 3 `signal_catalog` table.

## Recommendation

### Edit `web/src/types/signals.ts`

```typescript
export type SignalValueType = 'numeric' | 'text' | 'bool';

export interface SignalCatalogEntry {
  name: string;                    // PK
  value_type: SignalValueType;
  source_module: string;           // e.g. 'fleet_telemetry', 'fleet_api'
  unit: string | null;
  description: string | null;
  first_seen_at: string;
  last_seen_at: string;
}
```

### Edit `web/src/api/types.ts`

Extend the re-export line:
```typescript
export type {
  SignalObservation, SignalSource,
  SignalCatalogEntry, SignalValueType,
} from '@/types/signals';
```

## Acceptance Criteria

- [ ] `SignalCatalogEntry` defined with 7 fields
- [ ] `SignalValueType` union exported
- [ ] Re-exported from `api/types.ts`
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\signals.ts -Pattern 'export interface SignalCatalogEntry'
# Expected: 1 hit
```

## Out of Scope

- Don't add discriminated union (prompt 09)
- Don't add hooks

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add SignalCatalogEntry type

Mirrors Phase 3 signal_catalog: name PK, value_type discriminator,
source_module, observation timestamps.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
